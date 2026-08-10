/**
 * Atlas Fiscal Models - Módulo de Taxonomia e Reconciliação Fiscal
 * Release 4 — Cartões ATLAS-023 a ATLAS-028
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const DisaggregationModels = typeof require !== 'undefined' ? require('./disaggregation_models.js') : (globalThis.DisaggregationModels || {});

  const { PROVENANCE_STATES, getProvenanceBadge } = AtlasCore;
  const { PopulationModel, HouseholdsModel, IncomeModel, EconomicActivityModel } = DisaggregationModels;

  // ==========================================
  // ATLAS-023: Taxonomia Fiscal e Prevenção de Dupla Contagem
  // ==========================================

  const FISCAL_CATEGORIES = Object.freeze({
    FEDERAL_COLLECTED: "tributos_federais_locais",
    STATE_COLLECTED: "tributos_estaduais_locais",
    MUNICIPAL_OWN: "tributos_municipais_proprios",
    SOCIAL_SECURITY: "contribuisoes_previdenciarias",
    TRANSFERS_RECEIVED: "transferencias_recebidas",
    NON_TAX_REVENUE: "receitas_nao_tributarias",
    TAX_EXEMPTIONS: "renuncias_e_restituicoes",
    ESTIMATED_RESIDENT_TAX_BURDEN: "carga_tributaria_residentes",
    REGISTERED_LOCATION_COLLECTION: "arrecadacao_registrada_local"
  });

  class FiscalTaxonomy {
    static validateNoDoubleCounting(records = [], options = {}) {
      const { allowDirectSumming = false } = options;
      const hasTransfers = records.some(r => r.category === FISCAL_CATEGORIES.TRANSFERS_RECEIVED);
      const hasResidentBurden = records.some(r => r.category === FISCAL_CATEGORIES.ESTIMATED_RESIDENT_TAX_BURDEN);

      if (hasTransfers && hasResidentBurden) {
        if (allowDirectSumming) {
          return Object.freeze({
            valid: false,
            error: "Erro de dupla contagem: Transferências recebidas (FPM/ICMS) não podem ser somadas diretamente à carga tributária dos residentes."
          });
        }
        return Object.freeze({
          valid: true,
          notice: "Aviso: Transferências recebidas (FPM/ICMS) são mantidas separadas da carga tributária suportada pelos residentes para evitar dupla contagem."
        });
      }
      return Object.freeze({ valid: true, notice: "Sem sobreposição de categorias fiscais." });
    }
  }

  // ==========================================
  // ATLAS-024: Repositório de Arrecadação Federal (Receita Federal)
  // ==========================================

  class FederalRevenueRepository {
    constructor() {
      this.records = new Map();
    }

    registerCollection(params) {
      const {
        municipalityId,
        year,
        month = null,
        taxType,
        valueReais
      } = params;

      const key = `${municipalityId}:${year}:${month || 'ANNUAL'}:${taxType}`;
      const record = Object.freeze({
        municipalityId: String(municipalityId),
        year: String(year),
        month: month ? String(month) : null,
        taxType,
        valueReais: Number(valueReais),
        provenanceState: PROVENANCE_STATES.OFFICIAL_OBSERVED,
        label: "Arrecadação registrada no local (Receita Federal)",
        notice: "Representa a arrecadação contábil registrada no município, não necessariamente a incidência econômica final."
      });

      this.records.set(key, record);
      return record;
    }
  }

  // ==========================================
  // ATLAS-025: Repositório Siconfi (Tributos Municipais)
  // ==========================================

  class SiconfiRepository {
    constructor() {
      this.records = new Map();
    }

    registerMunicipalTax(params) {
      const {
        municipalityId,
        year,
        taxCode, // IPTU, ISS, ITBI, IRRF, TAXAS, TRANSF
        stage = "recolhido", // previsao, liquidado, recolhido
        valueReais = null
      } = params;

      const key = `${municipalityId}:${year}:${taxCode}:${stage}`;
      const isAvailable = valueReais !== null && valueReais !== undefined;

      const record = Object.freeze({
        municipalityId: String(municipalityId),
        year: String(year),
        taxCode,
        stage,
        valueReais: isAvailable ? Number(valueReais) : null,
        provenanceState: isAvailable ? PROVENANCE_STATES.OFFICIAL_OBSERVED : PROVENANCE_STATES.UNAVAILABLE,
        isDeclarationMissing: !isAvailable
      });

      this.records.set(key, record);
      return record;
    }
  }

  // ==========================================
  // ATLAS-026: Métodos Fiscais por Tipo de Imposto
  // ==========================================

  const TAX_DISTRIBUTION_RULES = Object.freeze({
    IPTU: Object.freeze({
      taxName: "IPTU",
      preferredWeight: "imoveis_domicilios",
      fallbackWeight: "domicilios",
      description: "Distribuído por imóveis/domicílios ocupados."
    }),
    ITBI: Object.freeze({
      taxName: "ITBI",
      preferredWeight: "transacoes_valor_imobiliario",
      fallbackWeight: "domicilios_renda",
      description: "Distribuído por transações imobiliárias e renda."
    }),
    ISS: Object.freeze({
      taxName: "ISS",
      preferredWeight: "estabelecimentos_empregos_servicos",
      fallbackWeight: "renda_estabelecimentos",
      description: "Distribuído por serviços, estabelecimentos e empregos."
    }),
    IRPF: Object.freeze({
      taxName: "IRPF",
      preferredWeight: "renda_residencial_populacao_adulta",
      fallbackWeight: "populacao",
      description: "Distribuído por renda residencial e população."
    }),
    IRPJ_CSLL: Object.freeze({
      taxName: "IRPJ/CSLL",
      preferredWeight: "empresas_cnae_empregos",
      fallbackWeight: "estabelecimentos",
      description: "Distribuído por porte de empresas, CNAE e empregos."
    }),
    ITR: Object.freeze({
      taxName: "ITR",
      preferredWeight: "imoveis_area_rural",
      fallbackWeight: "area_rural",
      description: "Distribuído por imóveis e área rural."
    }),
    CONSUMPTION_ICMS_IBS: Object.freeze({
      taxName: "Consumo (ICMS/IBS)",
      preferredWeight: "consumo_renda_domiciliar",
      fallbackWeight: "populacao_renda",
      description: "Distribuído pelo consumo e renda domiciliar estimada."
    }),
    UNCLASSIFIED: Object.freeze({
      taxName: "Tributo Genérico",
      preferredWeight: "configuracao_indicador",
      fallbackWeight: "populacao",
      description: "Distribuído por peso populacional padrão."
    })
  });

  // ==========================================
  // ATLAS-027: Imposto Estimado por Setor
  // ==========================================

  class SectorTaxEngine {
    static calculateSectorTaxes(params) {
      const {
        taxCode = "IPTU",
        municipalTaxTotal,
        sectors = [] // Array de { id, population, households, averageIncome, activeEstablishmentsCount, areaKm2 }
      } = params;

      const rule = TAX_DISTRIBUTION_RULES[taxCode] || TAX_DISTRIBUTION_RULES.UNCLASSIFIED;
      const T = Number(municipalTaxTotal || 0);

      let modelResult;
      if (taxCode === "IPTU" || taxCode === "ITBI") {
        modelResult = HouseholdsModel.calculate({ officialParentTotal: T, sectors, allowEmptySectorFallback: true });
      } else if (taxCode === "ISS" || taxCode === "IRPJ_CSLL") {
        modelResult = EconomicActivityModel.calculate({ officialParentTotal: T, sectors });
      } else if (taxCode === "IRPF" || taxCode === "CONSUMPTION_ICMS_IBS") {
        modelResult = IncomeModel.calculate({ officialParentTotal: T, sectors });
      } else {
        modelResult = PopulationModel.calculate({ officialParentTotal: T, sectors });
      }

      const sectorResults = modelResult.sectors.map((sec, idx) => {
        const sector = sectors[idx];
        const val = sec.valorTotal;
        const pop = Number(sector.population || 0);
        const dom = Number(sector.households || 0);
        const area = Number(sector.areaKm2 || 0);

        return Object.freeze({
          sectorId: sector.id,
          taxCode,
          impostoTotalEstimado: val,
          impostoPerCapita: pop > 0 ? val / pop : null,
          impostoPorDomicilio: dom > 0 ? val / dom : null,
          impostoPorKm2: area > 0 ? val / area : null,
          participacaoNoMunicipioPercent: T > 0 ? (val / T) * 100 : 0,
          provenanceBadge: getProvenanceBadge(PROVENANCE_STATES.ESTIMATED_PROPORTIONAL),
          equationUsed: `imposto_setor = T_municipality * peso_${rule.preferredWeight} / sum(pesos)`
        });
      });

      return Object.freeze({
        taxCode,
        taxName: rule.taxName,
        municipalTaxTotal: T,
        appliedRule: rule,
        sectors: Object.freeze(sectorResults)
      });
    }
  }

  // ==========================================
  // ATLAS-028: Reconciliação Fiscal Multinível
  // ==========================================

  class FiscalReconciliationEngine {
    static reconcileMultilevel(params) {
      const {
        taxCode,
        nationalOfficial = null,
        stateOfficial = null,
        municipalitiesOfficialSum = null,
        sectorsEstimatedSum = null,
        coverageGapNotice = null
      } = params;

      const nat = nationalOfficial !== null ? Number(nationalOfficial) : null;
      const st = stateOfficial !== null ? Number(stateOfficial) : null;
      const mun = municipalitiesOfficialSum !== null ? Number(municipalitiesOfficialSum) : null;
      const sec = sectorsEstimatedSum !== null ? Number(sectorsEstimatedSum) : null;

      const deltaSecMun = (sec !== null && mun !== null) ? sec - mun : null;
      const deltaMunSt = (mun !== null && st !== null) ? mun - st : null;

      return Object.freeze({
        taxCode,
        nationalOfficial: nat,
        stateOfficial: st,
        municipalitiesOfficialSum: mun,
        sectorsEstimatedSum: sec,
        deltaSectorsVsMunicipality: deltaSecMun,
        deltaMunicipalitiesVsState: deltaMunSt,
        coverageGapNotice: coverageGapNotice || "Reconciliação sem perdas de cobertura detectadas.",
        activeDisplayMode: "valor_oficial" // Permite alternar entre "valor_oficial" e "valor_reconstruido"
      });
    }
  }

  // Exports
  exports.FISCAL_CATEGORIES = FISCAL_CATEGORIES;
  exports.FiscalTaxonomy = FiscalTaxonomy;
  exports.FederalRevenueRepository = FederalRevenueRepository;
  exports.SiconfiRepository = SiconfiRepository;
  exports.TAX_DISTRIBUTION_RULES = TAX_DISTRIBUTION_RULES;
  exports.SectorTaxEngine = SectorTaxEngine;
  exports.FiscalReconciliationEngine = FiscalReconciliationEngine;

})(typeof exports !== 'undefined' ? exports : (globalThis.FiscalModels = {}));
