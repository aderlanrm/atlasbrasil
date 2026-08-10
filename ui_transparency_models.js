/**
 * Atlas UI Transparency Models - Motor de Interface, Selos Visuais e Explicação de Cálculos
 * Release 7 — Cartões ATLAS-040 a ATLAS-043
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const { PROVENANCE_STATES } = AtlasCore;

  // ==========================================
  // ATLAS-040: Catálogo Completo de Selos Visuais
  // ==========================================

  const VISUAL_BADGES = Object.freeze({
    OFFICIAL: Object.freeze({
      key: "official",
      label: "Oficial",
      badgeClass: "provenance-badge-official",
      description: "Dado oficial publicado pela fonte primária no nível territorial."
    }),
    AGGREGATED: Object.freeze({
      key: "aggregated",
      label: "Agregado",
      badgeClass: "provenance-badge-derived",
      description: "Valor obtido pela soma direta dos sub-níveis oficiais."
    }),
    ESTIMATED_PROPORTIONAL: Object.freeze({
      key: "estimated_proportional",
      label: "Estimado Proporcional",
      badgeClass: "provenance-badge-estimated",
      description: "Estimativa por rateio de pesos territoriais (população, domicílios, etc)."
    }),
    ESTIMATED_MODEL: Object.freeze({
      key: "estimated_model",
      label: "Estimado por Modelo",
      badgeClass: "provenance-badge-model",
      description: "Estimativa calculada por modelo estatístico ou híbrido multi-critério."
    }),
    PARENT_CONTEXT: Object.freeze({
      key: "parent_context",
      label: "Contexto do Nível-Pai",
      badgeClass: "provenance-badge-parent",
      description: "Valor de nível superior exibido como referência contextual."
    }),
    ADAPTED_GEOGRAPHY: Object.freeze({
      key: "adapted_geography",
      label: "Geografia Adaptada",
      badgeClass: "provenance-badge-adapted",
      description: "Dado ajustado à malha territorial atual via tabela de correspondência."
    }),
    DIVERGENCE: Object.freeze({
      key: "divergence",
      label: "Divergência",
      badgeClass: "provenance-badge-unavailable",
      description: "Diferença identificada entre a soma das partes e o valor pai oficial."
    }),
    PARTIAL_COVERAGE: Object.freeze({
      key: "partial_coverage",
      label: "Cobertura Parcial",
      badgeClass: "provenance-badge-suppressed",
      description: "Dados disponíveis para apenas uma fração das entidades filhas."
    })
  });

  class VisualBadgeCatalog {
    static getBadge(badgeKey) {
      return VISUAL_BADGES[badgeKey] || VISUAL_BADGES.OFFICIAL;
    }

    static getBadgeHTML(badgeKey) {
      const b = this.getBadge(badgeKey);
      return `<span class="provenance-badge ${b.badgeClass}" title="${b.description}">${b.label}</span>`;
    }
  }

  // ==========================================
  // ATLAS-041: Seletor de Interpretação
  // ==========================================

  const INTERPRETATION_MODES = Object.freeze({
    TOTAL: "total",
    PER_CAPITA: "per_capita",
    PER_HOUSEHOLD: "per_household",
    PER_KM2: "per_km2",
    MUNICIPAL_SHARE: "municipal_share",
    REFERENCE_DIFFERENCE: "reference_difference"
  });

  class InterpretationSelector {
    static convertValue(rawTotal, mode = INTERPRETATION_MODES.TOTAL, denominatorData = {}) {
      const val = Number(rawTotal || 0);
      const { population, households, areaKm2, municipalTotal, referenceValue } = denominatorData;

      switch (mode) {
        case INTERPRETATION_MODES.PER_CAPITA:
          return (population && population > 0) ? val / population : null;
        case INTERPRETATION_MODES.PER_HOUSEHOLD:
          return (households && households > 0) ? val / households : null;
        case INTERPRETATION_MODES.PER_KM2:
          return (areaKm2 && areaKm2 > 0) ? val / areaKm2 : null;
        case INTERPRETATION_MODES.MUNICIPAL_SHARE:
          return (municipalTotal && municipalTotal > 0) ? (val / municipalTotal) * 100 : null;
        case INTERPRETATION_MODES.REFERENCE_DIFFERENCE:
          return referenceValue !== undefined ? val - Number(referenceValue) : null;
        case INTERPRETATION_MODES.TOTAL:
        default:
          return val;
      }
    }
  }

  // ==========================================
  // ATLAS-042: Painel "Como este valor foi calculado?"
  // ==========================================

  class ValueCalculationPanel {
    static generateCalculationDetails(params) {
      const {
        sourceName = "IBGE / SIDRA",
        officialLevel = "N6 (Município)",
        originalValue = null,
        formula = "valor_setor = T * peso_setor / soma_dos_pesos",
        sectorWeight = null,
        denominator = "População Residente",
        date = "2022",
        geographyVintage = "2022",
        reconciliationDifference = 0
      } = params;

      return Object.freeze({
        sourceName,
        officialLevel,
        originalValue: originalValue !== null ? Number(originalValue) : null,
        formula,
        sectorWeight: sectorWeight !== null ? Number(sectorWeight) : null,
        denominator,
        date: String(date),
        geographyVintage: String(geographyVintage),
        reconciliationDifference: Number(reconciliationDifference),
        htmlExplanation: `
          <div class="calculation-panel" style="font-size: 11px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
            <strong>Como este valor foi calculado?</strong>
            <ul style="margin: 4px 0; padding-left: 16px;">
              <li><strong>Fonte:</strong> ${sourceName} (${date})</li>
              <li><strong>Nível Oficial:</strong> ${officialLevel}</li>
              <li><strong>Fórmula:</strong> <code>${formula}</code></li>
              <li><strong>Denominador:</strong> ${denominator}</li>
              <li><strong>Versão Geográfica:</strong> ${geographyVintage}</li>
              <li><strong>Diferença de Reconciliação:</strong> ${reconciliationDifference}</li>
            </ul>
          </div>
        `
      });
    }
  }

  // ==========================================
  // ATLAS-043: Exibição de Divergências Hierárquicas
  // ==========================================

  class HierarchicalDivergenceDisplay {
    static formatDivergenceCard(params) {
      const {
        childrenSumName = "Soma dos municípios",
        childrenSumValue = 0,
        parentOfficialName = "Total oficial do estado",
        parentOfficialValue = 0,
        possibleCause = "Diferença de cobertura ou exercício contábil."
      } = params;

      const sumVal = Number(childrenSumValue);
      const parentVal = Number(parentOfficialValue);
      const delta = sumVal - parentVal;
      const deltaPercent = parentVal !== 0 ? (delta / parentVal) * 100 : 0;

      return Object.freeze({
        childrenSumName,
        childrenSumValue: sumVal,
        parentOfficialName,
        parentOfficialValue: parentVal,
        delta,
        deltaPercent,
        possibleCause,
        formattedMessage: `${childrenSumName}: R$ ${(sumVal / 1e9).toFixed(1)} bilhões | ${parentOfficialName}: R$ ${(parentVal / 1e9).toFixed(1)} bilhões | Diferença: ${delta >= 0 ? '+' : ''}R$ ${(delta / 1e6).toFixed(1)} milhões (${deltaPercent.toFixed(2)}%) | Causa: ${possibleCause}`,
        htmlCard: `
          <div class="reconciliation-card warning" style="padding: 6px 10px; margin-top: 6px; font-size: 11px;">
            <div><strong>Divergência Hierárquica Detectada</strong></div>
            <div>${childrenSumName}: <strong>R$ ${sumVal.toLocaleString('pt-BR')}</strong></div>
            <div>${parentOfficialName}: <strong>R$ ${parentVal.toLocaleString('pt-BR')}</strong></div>
            <div style="color: #fbbf24;">Diferença: <strong>R$ ${delta.toLocaleString('pt-BR')} (${deltaPercent.toFixed(2)}%)</strong></div>
            <small>Causa provável: ${possibleCause}</small>
          </div>
        `
      });
    }
  }

  // Exports
  exports.VISUAL_BADGES = VISUAL_BADGES;
  exports.VisualBadgeCatalog = VisualBadgeCatalog;
  exports.INTERPRETATION_MODES = INTERPRETATION_MODES;
  exports.InterpretationSelector = InterpretationSelector;
  exports.ValueCalculationPanel = ValueCalculationPanel;
  exports.HierarchicalDivergenceDisplay = HierarchicalDivergenceDisplay;

})(typeof exports !== 'undefined' ? exports : (globalThis.UITransparencyModels = {}));
