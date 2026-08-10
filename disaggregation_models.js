/**
 * Atlas Disaggregation Models - Motor Genérico de Proporcionalização Multi-Modelo
 * Release 2 — Cartões ATLAS-012 a ATLAS-017
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const { PROVENANCE_STATES, getProvenanceBadge } = AtlasCore;

  // ==========================================
  // Algoritmo do Maior Resto (Hare-Niemeyer / Largest Remainder)
  // ==========================================

  /**
   * Distribui resíduos inteiros de arredondamento de forma determinística
   * para garantir que a soma dos setores seja exatamente igual ao total oficial do município.
   */
  function distributeIntegerRemainder(exactValues, targetSum) {
    if (!Array.isArray(exactValues) || exactValues.length === 0) return [];

    const floorValues = exactValues.map(v => Math.floor(v));
    const currentSum = floorValues.reduce((a, b) => a + b, 0);
    let remainder = Math.round(targetSum - currentSum);

    if (remainder === 0) return floorValues;

    // Calcula os restos fracionários preservando o índice original
    const fractions = exactValues.map((v, index) => ({
      index,
      fraction: v - Math.floor(v)
    }));

    // Ordena de forma determinística decrescente pela fração (e por índice em caso de empate)
    fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);

    const result = [...floorValues];
    for (let i = 0; i < remainder && i < fractions.length; i++) {
      result[fractions[i].index] += 1;
    }

    return result;
  }

  // ==========================================
  // ATLAS-012: Modelo Proporcional Populacional
  // ==========================================

  class PopulationModel {
    static calculate(params) {
      const {
        officialParentTotal,
        sectors = [] // Array de { id, population, areaKm2, households }
      } = params;

      const T = Number(officialParentTotal || 0);
      const totalPop = sectors.reduce((acc, s) => acc + Number(s.population || 0), 0);

      if (totalPop <= 0) {
        throw new Error("A população total dos setores deve ser maior que zero.");
      }

      const exactValues = sectors.map(s => (T * Number(s.population || 0)) / totalPop);
      const integerAdjusted = Number.isInteger(T) ? distributeIntegerRemainder(exactValues, T) : exactValues;

      const results = sectors.map((sector, idx) => {
        const valorTotal = integerAdjusted[idx];
        const pop = Number(sector.population || 0);
        const area = Number(sector.areaKm2 || 0);
        const dom = Number(sector.households || 0);

        return Object.freeze({
          sectorId: sector.id,
          valorTotal,
          valorPerCapita: pop > 0 ? valorTotal / pop : null,
          valorPorDomicilio: dom > 0 ? valorTotal / dom : null,
          densidadeKm2: area > 0 ? valorTotal / area : null,
          provenanceState: PROVENANCE_STATES.ESTIMATED_PROPORTIONAL,
          provenanceBadge: Object.freeze({
            label: "Estimativa proporcional à população",
            badgeClass: "provenance-badge-estimated",
            description: "Valor setorizado proporcionalmente à população residente com ajuste de resto."
          })
        });
      });

      return Object.freeze({
        modelName: "Proporcional Populacional",
        totalMunicipality: T,
        totalPopulation: totalPop,
        sectors: Object.freeze(results)
      });
    }
  }

  // ==========================================
  // ATLAS-013: Modelo Proporcional por Domicílios
  // ==========================================

  class HouseholdsModel {
    static calculate(params) {
      const {
        officialParentTotal,
        sectors = [], // Array de { id, households, sourceYear }
        allowEmptySectorFallback = false
      } = params;

      const T = Number(officialParentTotal || 0);
      const totalHouseholds = sectors.reduce((acc, s) => acc + Number(s.households || 0), 0);

      if (totalHouseholds <= 0 && !allowEmptySectorFallback) {
        throw new Error("O total de domicílios ocupados deve ser maior que zero.");
      }

      const exactValues = sectors.map(sector => (
        totalHouseholds > 0
          ? (T * Number(sector.households || 0)) / totalHouseholds
          : 0
      ));
      const adjustedValues = Number.isInteger(T)
        ? distributeIntegerRemainder(exactValues, T)
        : exactValues;

      const results = sectors.map((sector, index) => {
        const dom = Number(sector.households || 0);
        const valorTotal = adjustedValues[index];

        return Object.freeze({
          sectorId: sector.id,
          valorTotal,
          householdsCount: dom,
          householdsSourceYear: sector.sourceYear || "2022",
          provenanceState: PROVENANCE_STATES.ESTIMATED_PROPORTIONAL,
          provenanceBadge: Object.freeze({
            label: "Estimativa proporcional por domicílios",
            badgeClass: "provenance-badge-estimated",
            description: `Ponderado pelos domicílios ocupados da fonte Censo (${sector.sourceYear || "2022"}).`
          })
        });
      });

      return Object.freeze({
        modelName: "Proporcional por Domicílios",
        totalMunicipality: T,
        totalHouseholds,
        sectors: Object.freeze(results)
      });
    }
  }

  // ==========================================
  // ATLAS-014: Modelo por Renda
  // ==========================================

  class IncomeModel {
    static calculate(params) {
      const {
        officialParentTotal,
        sectors = [] // Array de { id, population, averageIncome }
      } = params;

      const T = Number(officialParentTotal || 0);
      const sectorIncomeMasses = sectors.map(s => Number(s.population || 0) * Number(s.averageIncome || 0));
      const totalIncomeMass = sectorIncomeMasses.reduce((a, b) => a + b, 0);

      if (totalIncomeMass <= 0) {
        throw new Error("A massa de renda total dos setores deve ser maior que zero.");
      }

      const results = sectors.map((sector, idx) => {
        const mass = sectorIncomeMasses[idx];
        const valorTotal = (T * mass) / totalIncomeMass;

        return Object.freeze({
          sectorId: sector.id,
          valorTotal,
          incomeMass: mass,
          provenanceState: PROVENANCE_STATES.ESTIMATED_MODEL,
          provenanceBadge: Object.freeze({
            label: "Estimativa por renda residencial",
            badgeClass: "provenance-badge-model",
            description: "Ponderado pela massa de rendimento residencial do Censo Demográfico."
          })
        });
      });

      return Object.freeze({
        modelName: "Modelo por Renda Residencial",
        totalMunicipality: T,
        totalIncomeMass,
        sectors: Object.freeze(results)
      });
    }
  }

  // ==========================================
  // ATLAS-015: Modelo por Atividade Econômica
  // ==========================================

  class EconomicActivityModel {
    static calculate(params) {
      const {
        officialParentTotal,
        sectors = [] // Array de { id, activeEstablishmentsCount, cnaeWeights, totalPayroll }
      } = params;

      const T = Number(officialParentTotal || 0);

      const sectorWeights = sectors.map(s => {
        const count = Number(s.activeEstablishmentsCount || 0);
        const payroll = Number(s.totalPayroll || 0);
        const cnaeFactor = Number(s.cnaeWeights || 1.0);
        return (count * cnaeFactor) + (payroll * 0.001);
      });

      const totalWeight = sectorWeights.reduce((a, b) => a + b, 0);
      if (totalWeight <= 0) {
        throw new Error("O peso econômico total dos setores deve ser maior que zero.");
      }

      const results = sectors.map((sector, idx) => {
        const weight = sectorWeights[idx];
        const valorTotal = (T * weight) / totalWeight;

        return Object.freeze({
          sectorId: sector.id,
          valorTotal,
          economicWeight: weight,
          provenanceState: PROVENANCE_STATES.ESTIMATED_MODEL,
          provenanceBadge: Object.freeze({
            label: "Estimativa por atividade econômica",
            badgeClass: "provenance-badge-model",
            description: "Ponderado por geocodificação CNEFE/RFB, massa salarial e porte CNAE."
          })
        });
      });

      return Object.freeze({
        modelName: "Atividade Econômica",
        totalMunicipality: T,
        totalEconomicWeight: totalWeight,
        sectors: Object.freeze(results)
      });
    }
  }

  // ==========================================
  // ATLAS-016: Modelo Híbrido Configurável
  // ==========================================

  class HybridModel {
    static validateWeights(weights = {}) {
      const { income = 0, jobs = 0, establishments = 0, population = 0 } = weights;
      const sum = Number((income + jobs + establishments + population).toFixed(4));
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new Error(`A soma dos pesos do modelo híbrido deve ser igual a 100% (1.0). Soma atual: ${sum}`);
      }
      return true;
    }

    static calculate(params) {
      const {
        officialParentTotal,
        weights = { income: 0.40, jobs: 0.30, establishments: 0.20, population: 0.10 },
        sectors = [],
        version = "1.0"
      } = params;

      this.validateWeights(weights);
      const T = Number(officialParentTotal || 0);

      const popResult = PopulationModel.calculate({ officialParentTotal: T, sectors });
      const incResult = IncomeModel.calculate({ officialParentTotal: T, sectors });
      const econResult = EconomicActivityModel.calculate({ officialParentTotal: T, sectors });

      const results = sectors.map((sector, idx) => {
        const vPop = popResult.sectors[idx].valorTotal;
        const vInc = incResult.sectors[idx].valorTotal;
        const vEcon = econResult.sectors[idx].valorTotal;

        // Combinação convexa parametrizada
        const hybridValue = (vInc * weights.income) +
                            (vEcon * weights.jobs) +
                            (vEcon * weights.establishments) +
                            (vPop * weights.population);

        return Object.freeze({
          sectorId: sector.id,
          valorTotal: hybridValue,
          populationBaselineValue: vPop,
          varianceVsPopulationPercent: vPop > 0 ? ((hybridValue - vPop) / vPop) * 100 : 0,
          provenanceState: PROVENANCE_STATES.ESTIMATED_MODEL,
          provenanceBadge: Object.freeze({
            label: `Modelo Híbrido v${version}`,
            badgeClass: "provenance-badge-model",
            description: `Modelo multi-critério: ${weights.income * 100}% Renda, ${(weights.jobs + weights.establishments) * 100}% Econômico, ${weights.population * 100}% População.`
          })
        });
      });

      return Object.freeze({
        modelName: "Modelo Híbrido Configurável",
        modelVersion: version,
        configuredWeights: Object.freeze({ ...weights }),
        totalMunicipality: T,
        sectors: Object.freeze(results)
      });
    }
  }

  // ==========================================
  // ATLAS-017: Calculadora de Métricas Territoriais
  // ==========================================

  class TerritorialMetricsCalculator {
    static calculateMetrics(params) {
      const {
        totalValue,
        population = null,
        households = null,
        totalAreaKm2 = null,
        domiciledAreaKm2 = null,
        valueYear = "2022",
        denominatorYear = "2022"
      } = params;

      const val = Number(totalValue || 0);
      const pop = population !== null ? Number(population) : null;
      const dom = households !== null ? Number(households) : null;
      const areaTot = totalAreaKm2 !== null ? Number(totalAreaKm2) : null;
      const areaDom = domiciledAreaKm2 !== null ? Number(domiciledAreaKm2) : null;

      return Object.freeze({
        totalValue: val,
        perCapita: (pop !== null && pop > 0) ? val / pop : null,
        perHousehold: (dom !== null && dom > 0) ? val / dom : null,
        densityPerKm2Total: (areaTot !== null && areaTot > 0) ? val / areaTot : null,
        densityPerKm2Domiciled: (areaDom !== null && areaDom > 0) ? val / areaDom : null,
        metadata: Object.freeze({
          valueYear: String(valueYear),
          denominatorYear: String(denominatorYear),
          populationUsed: pop,
          householdsUsed: dom,
          totalAreaKm2Used: areaTot,
          domiciledAreaKm2Used: areaDom
        })
      });
    }
  }

  // Exports
  exports.distributeIntegerRemainder = distributeIntegerRemainder;
  exports.PopulationModel = PopulationModel;
  exports.HouseholdsModel = HouseholdsModel;
  exports.IncomeModel = IncomeModel;
  exports.EconomicActivityModel = EconomicActivityModel;
  exports.HybridModel = HybridModel;
  exports.TerritorialMetricsCalculator = TerritorialMetricsCalculator;

})(typeof exports !== 'undefined' ? exports : (globalThis.DisaggregationModels = {}));
