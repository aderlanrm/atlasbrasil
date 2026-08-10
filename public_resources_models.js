/**
 * Atlas Public Resources Models - Módulo de Recursos Públicos, Cenários e Balanço Fiscal Territorial
 * Release 5 — Cartões ATLAS-029 a ATLAS-036
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const DisaggregationModels = typeof require !== 'undefined' ? require('./disaggregation_models.js') : (globalThis.DisaggregationModels || {});

  const { PROVENANCE_STATES, getProvenanceBadge } = AtlasCore;
  const { PopulationModel } = DisaggregationModels;

  // ==========================================
  // ATLAS-029: Separar Recurso Recebido de Despesa Executada
  // ==========================================

  const EXPENSE_STAGES = Object.freeze({
    TRANSFER_RECEIVED: "transferencia_recebida",
    AUTHORIZED_BUDGET: "orcamento_autorizado",
    COMMITTED_EXPENSE: "despesa_empenhada",
    LIQUIDATED_EXPENSE: "despesa_liquidada",
    PAID_EXPENSE: "despesa_paga",
    INVESTMENT_WORK: "investimento_obra",
    CURRENT_EXPENSE: "gasto_corrente",
    EXPENSE_BY_FUNCTION: "gasto_por_funcao"
  });

  class ExpenseStageTracker {
    static createRecord(params) {
      const {
        entityId,
        year,
        stage = EXPENSE_STAGES.PAID_EXPENSE,
        valueReais,
        functionName = "Geral",
        isMultiYear = false
      } = params;

      return Object.freeze({
        entityId: String(entityId),
        year: String(year),
        stage,
        valueReais: Number(valueReais),
        functionName,
        isMultiYear: Boolean(isMultiYear),
        provenanceState: PROVENANCE_STATES.OFFICIAL_OBSERVED,
        warningNotice: isMultiYear
          ? "Atenção: Orçamento plurianual não deve ser comparado diretamente com a arrecadação de um único ano fiscal sem ajustes."
          : null
      });
    }
  }

  // ==========================================
  // ATLAS-030: Repositório de Despesas Municipais e Estaduais (Siconfi, SIOPE, SIOPS)
  // ==========================================

  class PublicExpenseRepository {
    constructor() {
      this.records = new Map();
    }

    registerExpense(params) {
      const {
        entityId,
        year,
        sourceSystem = "Siconfi", // Siconfi, SIOPE, SIOPS
        functionCode, // ex: "12" (Educação), "10" (Saúde)
        subfunctionCode = null,
        valueReais,
        isDeclaredByEntity = true
      } = params;

      const key = `${sourceSystem}:${entityId}:${year}:${functionCode}:${subfunctionCode || 'GENERIC'}`;
      const record = Object.freeze({
        entityId: String(entityId),
        year: String(year),
        sourceSystem,
        functionCode: String(functionCode),
        subfunctionCode: subfunctionCode ? String(subfunctionCode) : null,
        valueReais: Number(valueReais),
        isDeclaredByEntity: Boolean(isDeclaredByEntity),
        provenanceState: PROVENANCE_STATES.OFFICIAL_OBSERVED
      });

      this.records.set(key, record);
      return record;
    }
  }

  // ==========================================
  // ATLAS-031: Importar Transferências Federais (Nova API Transferegov)
  // ==========================================

  class TransferegovRepository {
    constructor() {
      this.instruments = new Map();
    }

    registerInstrument(params) {
      const {
        instrumentId,
        concedente,
        recebedor,
        finalidade,
        valorReais,
        anoPeriodo,
        apiVersion = "new_transferegov_api_v2"
      } = params;

      if (!instrumentId || !concedente || !recebedor) {
        throw new Error("Transferegov exige instrumentId, concedente e recebedor.");
      }

      const record = Object.freeze({
        instrumentId: String(instrumentId),
        concedente: String(concedente),
        recebedor: String(recebedor),
        finalidade: String(finalidade),
        valorReais: Number(valorReais),
        anoPeriodo: String(anoPeriodo),
        apiVersion,
        provenanceState: PROVENANCE_STATES.OFFICIAL_OBSERVED
      });

      this.instruments.set(String(instrumentId), record);
      return record;
    }
  }

  // ==========================================
  // ATLAS-032: Obras e Investimentos Geolocalizados (ObrasGov)
  // ==========================================

  class ObrasGovRepository {
    constructor() {
      this.works = new Map();
    }

    registerWork(params) {
      const {
        workId,
        name,
        municipalityId,
        latitude = null,
        longitude = null,
        sectorId = null,
        financialValueReais,
        status = "em_execucao"
      } = params;

      const key = String(workId);
      const hasCoordinates = latitude !== null && longitude !== null;

      const record = Object.freeze({
        workId: key,
        name: String(name),
        municipalityId: String(municipalityId),
        latitude: hasCoordinates ? Number(latitude) : null,
        longitude: hasCoordinates ? Number(longitude) : null,
        sectorId: sectorId ? String(sectorId) : null,
        financialValueReais: Number(financialValueReais),
        status,
        isGeolocalized: hasCoordinates,
        assignedLevel: hasCoordinates && sectorId ? "N8_SETOR" : "N6_MUNICIPIO"
      });

      this.works.set(key, record);
      return record;
    }

    getWorksForSector(sectorId) {
      const results = [];
      this.works.forEach(work => {
        if (work.sectorId === String(sectorId)) {
          results.push(work);
        }
      });
      return results;
    }
  }

  // ==========================================
  // ATLAS-033 & ATLAS-034: Cenários de Distribuição e Necessidade Social
  // ==========================================

  class PublicResourceScenarios {
    /**
     * ATLAS-033: Cota per capita de referência
     */
    static calculatePopulationReferenceQuota(params) {
      const { officialMunicipalTotal, sectors = [] } = params;
      const baseResult = PopulationModel.calculate({
        officialParentTotal: officialMunicipalTotal,
        sectors
      });

      const sectorsWithNotice = baseResult.sectors.map(s => Object.freeze({
        ...s,
        scenarioName: "Referência distributiva por população",
        notice: "Cenário puramente analítico de referência per capita. Não constitui direito legal automático."
      }));

      return Object.freeze({
        scenarioId: "cota_populacional_referencia",
        scenarioName: "Referência Distributiva por População",
        totalDistributable: Number(officialMunicipalTotal),
        sectors: Object.freeze(sectorsWithNotice)
      });
    }

    /**
     * ATLAS-034: Cenário de Necessidade Social
     * peso = α*pop + β*vulnerabilidade + γ*pop_alvo + δ*custo_territorial
     */
    static calculateSocialNeedScenario(params) {
      const {
        officialMunicipalTotal,
        weights = { alpha: 0.3, beta: 0.3, gamma: 0.3, delta: 0.1 },
        sectors = [] // Array de { id, population, vulnerabilityIndex, targetPopulation, territorialCost }
      } = params;

      const T = Number(officialMunicipalTotal || 0);

      const sectorWeights = sectors.map(s => {
        const pop = Number(s.population || 0);
        const vul = Number(s.vulnerabilityIndex || 1.0);
        const targetPop = Number(s.targetPopulation || pop);
        const cost = Number(s.territorialCost || 1.0);

        return (weights.alpha * pop) +
               (weights.beta * pop * vul) +
               (weights.gamma * targetPop) +
               (weights.delta * pop * cost);
      });

      const totalWeight = sectorWeights.reduce((a, b) => a + b, 0);

      const sectorResults = sectors.map((sector, idx) => {
        const w = sectorWeights[idx];
        const valorTotal = totalWeight > 0 ? (T * w) / totalWeight : 0;
        const pop = Number(sector.population || 0);

        return Object.freeze({
          sectorId: sector.id,
          valorTotal,
          valorPerCapita: pop > 0 ? valorTotal / pop : null,
          scenarioName: "Cenário de Necessidade Social",
          notice: "Ponderado por vulnerabilidade social, população-alvo e custo de prestação territorial."
        });
      });

      return Object.freeze({
        scenarioId: "necessidade_social",
        scenarioName: "Cenário de Necessidade Social",
        configuredWeights: Object.freeze({ ...weights }),
        totalDistributable: T,
        sectors: Object.freeze(sectorResults)
      });
    }
  }

  // ==========================================
  // ATLAS-035: Calculadora da Lacuna de Investimento
  // ==========================================

  class InvestmentGapEngine {
    static calculateGap(params) {
      const {
        observedGeolocalizedInvestment = 0,
        unlocatedMunicipalInvestment = 0,
        populationReferenceQuota = 0,
        socialNeedQuota = 0
      } = params;

      const obs = Number(observedGeolocalizedInvestment);
      const unloc = Number(unlocatedMunicipalInvestment);
      const refPop = Number(populationReferenceQuota);
      const refSocial = Number(socialNeedQuota);

      const totalObservedOrEstimated = obs + unloc;
      const gapVsPopulation = obs - refPop;
      const gapVsSocialNeed = obs - refSocial;

      return Object.freeze({
        observedGeolocalizedInvestment: obs,
        unlocatedMunicipalInvestment: unloc,
        totalObservedOrEstimated,
        populationReferenceQuota: refPop,
        socialNeedQuota: refSocial,
        gapVsPopulation,
        gapVsSocialNeed,
        percentPopulationMet: refPop > 0 ? (obs / refPop) * 100 : 100,
        provenanceState: PROVENANCE_STATES.DERIVED_ROLLUP,
        notice: unloc > 0
          ? `Nota: R$ ${unloc.toLocaleString('pt-BR')} em investimentos municipais não possuem geocodificação direta para setores e estão registrados como não localizados.`
          : "Investimentos geolocalizados integralmente processados."
      });
    }
  }

  // ==========================================
  // ATLAS-036: Balanço Fiscal Territorial
  // ==========================================

  class TerritorialFiscalBalanceEngine {
    static calculateBalance(params) {
      const {
        sectorId,
        estimatedTaxPaid = 0,
        publicResourcesReceived = 0,
        observedInvestment = 0,
        proportionalInvestment = 0,
        functionFilter = "geral"
      } = params;

      const taxPaid = Number(estimatedTaxPaid);
      const resourcesRec = Number(publicResourcesReceived);
      const obsInv = Number(observedInvestment);
      const propInv = Number(proportionalInvestment);

      const estimatedFiscalBalance = resourcesRec - taxPaid;
      const investmentGap = obsInv - propInv;

      return Object.freeze({
        sectorId: String(sectorId),
        functionFilter,
        estimatedTaxPaid: taxPaid,
        publicResourcesReceived: resourcesRec,
        observedInvestment: obsInv,
        proportionalInvestment: propInv,
        estimatedFiscalBalance,
        investmentGap,
        constitutionalNotice: "A redistribuição fiscal entre territórios é uma função constitucional normal do sistema tributário e de políticas públicas."
      });
    }
  }

  // Exports
  exports.EXPENSE_STAGES = EXPENSE_STAGES;
  exports.ExpenseStageTracker = ExpenseStageTracker;
  exports.PublicExpenseRepository = PublicExpenseRepository;
  exports.TransferegovRepository = TransferegovRepository;
  exports.ObrasGovRepository = ObrasGovRepository;
  exports.PublicResourceScenarios = PublicResourceScenarios;
  exports.InvestmentGapEngine = InvestmentGapEngine;
  exports.TerritorialFiscalBalanceEngine = TerritorialFiscalBalanceEngine;

})(typeof exports !== 'undefined' ? exports : (globalThis.PublicResourcesModels = {}));
