/**
 * Atlas GDP Models - Módulo de PIB Proporcional e Comparador de Modelos
 * Release 3 — Cartões ATLAS-018 a ATLAS-022
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const DisaggregationModels = typeof require !== 'undefined' ? require('./disaggregation_models.js') : (globalThis.DisaggregationModels || {});

  const { PROVENANCE_STATES } = AtlasCore;
  const { PopulationModel, IncomeModel, EconomicActivityModel } = DisaggregationModels;

  // ==========================================
  // ATLAS-018: Repositório de PIB Oficial sem Projeção Silenciosa
  // ==========================================

  class OfficialGDPRepository {
    constructor() {
      this.records = new Map();
    }

    registerGDP(params) {
      const {
        entityId,
        level = "N6",
        year,
        valueReais,
        isOfficial = true,
        methodology = "IBGE/SIDRA 5938"
      } = params;

      const key = `${level}:${entityId}:${year}`;
      const record = Object.freeze({
        entityId: String(entityId),
        level,
        year: String(year),
        valueReais: Number(valueReais),
        isOfficial: Boolean(isOfficial),
        methodology,
        provenanceState: isOfficial ? PROVENANCE_STATES.OFFICIAL_OBSERVED : PROVENANCE_STATES.ESTIMATED_MODEL
      });

      this.records.set(key, record);
      return record;
    }

    getGDP(entityId, year, level = "N6") {
      const key = `${level}:${entityId}:${year}`;
      return this.records.get(key) || null;
    }

    reconcileStateGDP(stateId, year, municipalGDPList = []) {
      const stateGDP = this.getGDP(stateId, year, "N3");
      const municipalSum = municipalGDPList.reduce((a, b) => a + Number(b.valueReais || 0), 0);

      const stateVal = stateGDP ? stateGDP.valueReais : null;
      const delta = stateVal !== null ? municipalSum - stateVal : null;
      const deltaPercent = (stateVal && stateVal !== 0) ? (delta / stateVal) * 100 : null;

      return Object.freeze({
        stateId,
        year,
        stateOfficialGDP: stateVal,
        municipalitiesSum: municipalSum,
        delta,
        deltaPercent,
        reconciled: deltaPercent !== null && Math.abs(deltaPercent) <= 0.5
      });
    }
  }

  // ==========================================
  // ATLAS-019: PIB Setorial Estimado por População
  // ==========================================

  class PopulationGDPModel {
    static calculate(params) {
      const { officialMunicipalGDP, sectors = [] } = params;
      const baseResult = PopulationModel.calculate({
        officialParentTotal: officialMunicipalGDP,
        sectors
      });

      const sectorsWithLabels = baseResult.sectors.map(s => Object.freeze({
        ...s,
        modelLabel: "PIB estimado — distribuição populacional",
        warningNotice: "Neste modelo populacional simples, o PIB per capita é constante entre todos os setores do município."
      }));

      return Object.freeze({
        modelId: "pib_populacional",
        modelName: "PIB por Distribuição Populacional",
        officialMunicipalGDP: Number(officialMunicipalGDP),
        sectors: Object.freeze(sectorsWithLabels)
      });
    }
  }

  // ==========================================
  // ATLAS-020: PIB Residencial Estimado
  // ==========================================

  class ResidentialGDPModel {
    static calculate(params) {
      const { officialMunicipalGDP, sectors = [] } = params;
      const baseResult = IncomeModel.calculate({
        officialParentTotal: officialMunicipalGDP,
        sectors
      });

      const sectorsWithLabels = baseResult.sectors.map(s => Object.freeze({
        ...s,
        modelLabel: "PIB alocado por renda residencial",
        warningNotice: "Representa a localização da renda/riqueza dos residentes no território, e não o local de produção física de bens e serviços."
      }));

      return Object.freeze({
        modelId: "pib_residencial",
        modelName: "PIB Alocado por Renda Residencial",
        officialMunicipalGDP: Number(officialMunicipalGDP),
        sectors: Object.freeze(sectorsWithLabels)
      });
    }
  }

  // ==========================================
  // ATLAS-021: PIB Produtivo Estimado (Estabelecimentos / CNAE)
  // ==========================================

  class ProductiveGDPModel {
    static calculate(params) {
      const { officialMunicipalGDP, sectors = [] } = params;
      const baseResult = EconomicActivityModel.calculate({
        officialParentTotal: officialMunicipalGDP,
        sectors
      });

      const sectorsWithLabels = baseResult.sectors.map(s => Object.freeze({
        ...s,
        modelLabel: "PIB produtivo estimado (estabelecimentos/CNAE)",
        warningNotice: "Aproxima o local de geração de valor econômico e produção física, preservando distritos industriais e comerciais."
      }));

      return Object.freeze({
        modelId: "pib_produtivo",
        modelName: "PIB Produtivo Estimado",
        officialMunicipalGDP: Number(officialMunicipalGDP),
        sectors: Object.freeze(sectorsWithLabels)
      });
    }
  }

  // ==========================================
  // ATLAS-022: Comparador dos Três Modelos de PIB
  // ==========================================

  class GDPModelsComparator {
    static compareModels(params) {
      const { officialMunicipalGDP, sectors = [] } = params;

      const popModel = PopulationGDPModel.calculate({ officialMunicipalGDP, sectors });
      const resModel = ResidentialGDPModel.calculate({ officialMunicipalGDP, sectors });
      const prodModel = ProductiveGDPModel.calculate({ officialMunicipalGDP, sectors });

      const comparisons = sectors.map((sector, idx) => {
        const vPop = popModel.sectors[idx].valorTotal;
        const vRes = resModel.sectors[idx].valorTotal;
        const vProd = prodModel.sectors[idx].valorTotal;

        return Object.freeze({
          sectorId: sector.id,
          sectorName: sector.name || `Setor ${sector.id}`,
          pibPopulacional: vPop,
          pibResidencial: vRes,
          pibProdutivo: vProd,
          varianceProdVsPopPercent: vPop > 0 ? ((vProd - vPop) / vPop) * 100 : 0,
          disclaimerNote: "Nenhum destes modelos representa o PIB oficial do setor, mas sim interpretações desagregadas sob premissas distintas."
        });
      });

      return Object.freeze({
        officialMunicipalGDP: Number(officialMunicipalGDP),
        comparisons: Object.freeze(comparisons)
      });
    }
  }

  // Exports
  exports.OfficialGDPRepository = OfficialGDPRepository;
  exports.PopulationGDPModel = PopulationGDPModel;
  exports.ResidentialGDPModel = ResidentialGDPModel;
  exports.ProductiveGDPModel = ProductiveGDPModel;
  exports.GDPModelsComparator = GDPModelsComparator;

})(typeof exports !== 'undefined' ? exports : (globalThis.GDPModels = {}));
