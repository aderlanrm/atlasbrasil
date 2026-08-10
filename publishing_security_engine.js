/**
 * Atlas Publishing Security Engine - Motor de Segurança, Invariantes, Fixtures e Publicação Atômica
 * Release 8 — Cartões ATLAS-044 a ATLAS-048
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const { PROVENANCE_STATES } = AtlasCore;

  // ==========================================
  // ATLAS-044: Testes de Invariantes Obrigatórios
  // ==========================================

  class InvariantTester {
    static validateWeightsSum(weightsArray) {
      if (!Array.isArray(weightsArray) || weightsArray.length === 0) return true;
      const sum = weightsArray.reduce((a, b) => a + Number(b), 0);
      return Math.abs(sum - 1.0) <= 0.001;
    }

    static validateChildrenReproduceParent(parentTotal, childrenValues) {
      const sum = childrenValues.reduce((a, b) => a + Number(b || 0), 0);
      return Math.abs(sum - Number(parentTotal)) <= 0.01;
    }

    static validateNoDuplicatePoints(pointIds) {
      const set = new Set(pointIds);
      return set.size === pointIds.length;
    }

    static validateRatesHaveDenominator(indicatorMeta) {
      if (indicatorMeta.isAdditive === false) {
        return Boolean(indicatorMeta.denominator) || indicatorMeta.aggregationMethod === "none";
      }
      return true;
    }

    static validateNoNullToZero(originalValue, processedValue) {
      if (originalValue === null || originalValue === undefined) {
        return processedValue === null || processedValue === undefined;
      }
      return true;
    }

    static validateNoEstimatedBadgeAsOfficial(record) {
      if (record.provenanceState === PROVENANCE_STATES.OFFICIAL_OBSERVED || record.provenanceState === PROVENANCE_STATES.OFFICIAL_PARENT_CONTEXT) {
        return !record.isEstimated;
      }
      return true;
    }

    static validateTerritoryLifecycle(validFrom, validTo, targetYear) {
      const yr = Number(targetYear);
      if (validFrom && yr < Number(validFrom)) return false;
      if (validTo && yr > Number(validTo)) return false;
      return true;
    }

    static validateMonetaryHasCurrencyAndYear(monetaryRecord) {
      return Boolean(monetaryRecord.currency) && Boolean(monetaryRecord.year);
    }

    static runAllInvariants(dataset) {
      const violations = [];

      if (dataset.weights && !this.validateWeightsSum(dataset.weights)) {
        violations.push("Invariante 1 Falhou: A soma dos pesos deve ser exatamente 1.0.");
      }
      if (dataset.parentTotal !== undefined && dataset.childrenValues && !this.validateChildrenReproduceParent(dataset.parentTotal, dataset.childrenValues)) {
        violations.push("Invariante 2 Falhou: A soma dos filhos estimados deve reproduzir o total do pai.");
      }
      if (dataset.pointIds && !this.validateNoDuplicatePoints(dataset.pointIds)) {
        violations.push("Invariante 3 Falhou: Foram detectados pontos/estabelecimentos duplicados.");
      }
      if (dataset.indicatorMeta && !this.validateRatesHaveDenominator(dataset.indicatorMeta)) {
        violations.push("Invariante 4 Falhou: Indicador não aditivo (taxa) deve explicitar denominador.");
      }
      if (dataset.originalValue === null && !this.validateNoNullToZero(dataset.originalValue, dataset.processedValue)) {
        violations.push("Invariante 5 Falhou: Valor nulo/ausente foi silenciosamente convertido em zero.");
      }
      if (dataset.record && !this.validateNoEstimatedBadgeAsOfficial(dataset.record)) {
        violations.push("Invariante 6 Falhou: Registro estimado recebeu indevidamente o selo de Oficial.");
      }

      return Object.freeze({
        passAll: violations.length === 0,
        violations: Object.freeze(violations)
      });
    }
  }

  // ==========================================
  // ATLAS-045: Fixtures Pequenas de Referência
  // ==========================================

  const REFERENCE_FIXTURES = Object.freeze({
    recife: Object.freeze({ id: "2611606", name: "Recife", uf: "PE", type: "urban_metropolitan" }),
    jaboatao: Object.freeze({ id: "2607901", name: "Jaboatão dos Guararapes", uf: "PE", type: "urban_suburban" }),
    ibimirim: Object.freeze({ id: "2606804", name: "Ibimirim", uf: "PE", type: "rural_semiarid" }),
    boaEsperancaDoNorte: Object.freeze({ id: "5101850", name: "Boa Esperança do Norte", uf: "MT", type: "new_municipality" }),
    brasilia: Object.freeze({ id: "5300108", name: "Brasília", uf: "DF", type: "federal_district" }),
    noronha: Object.freeze({ id: "2605459", name: "Distrito Estadual de Fernando de Noronha", uf: "PE", type: "state_district" })
  });

  class ReferenceFixturesRepository {
    static getFixture(key) {
      return REFERENCE_FIXTURES[key] || null;
    }
    static getAllFixtures() {
      return REFERENCE_FIXTURES;
    }
  }

  // ==========================================
  // ATLAS-046: Publicação Offline Atômica
  // ==========================================

  class AtomicPublisher {
    constructor() {
      this.currentPublishedVersion = "v1.0.0";
      this.publishedManifest = null;
      this.backupVersion = null;
    }

    publishStaging(stagingManifest, stagingDataset) {
      const validation = InvariantTester.runAllInvariants(stagingDataset);

      if (!validation.passAll) {
        return Object.freeze({
          success: false,
          blockedPublication: true,
          violations: validation.violations,
          currentPublishedVersion: this.currentPublishedVersion,
          notice: "Publicação cancelada. A versão publicada anterior permanece intacta."
        });
      }

      this.backupVersion = this.currentPublishedVersion;
      this.currentPublishedVersion = stagingManifest.version;
      this.publishedManifest = Object.freeze({ ...stagingManifest, publishedAt: new Date().toISOString() });

      return Object.freeze({
        success: true,
        blockedPublication: false,
        publishedVersion: this.currentPublishedVersion,
        manifest: this.publishedManifest,
        notice: "Publicação atômica concluída com sucesso."
      });
    }

    rollback() {
      if (this.backupVersion) {
        this.currentPublishedVersion = this.backupVersion;
        return true;
      }
      return false;
    }
  }

  // ==========================================
  // ATLAS-047: Relatório de Atualização Pré-Release
  // ==========================================

  class UpdateReportGenerator {
    static generatePreReleaseReport(params) {
      const {
        updatedSources = [],
        unavailableSources = [],
        schemaChanges = [],
        createdMunicipalities = [],
        extinctMunicipalities = [],
        divergentValues = [],
        versionName = "v1.1.0"
      } = params;

      return Object.freeze({
        versionName,
        generatedAt: new Date().toISOString(),
        updatedSourcesCount: updatedSources.length,
        unavailableSourcesCount: unavailableSources.length,
        schemaChangesCount: schemaChanges.length,
        createdMunicipalitiesCount: createdMunicipalities.length,
        extinctMunicipalitiesCount: extinctMunicipalities.length,
        divergentValuesCount: divergentValues.length,
        isReadyForRelease: unavailableSources.length === 0 && schemaChanges.length === 0,
        summaryMarkdown: `
# Relatório Pré-Release (${versionName})
- **Fontes Atualizadas:** ${updatedSources.length}
- **Fontes Indisponíveis:** ${unavailableSources.length}
- **Alterações de Esquema:** ${schemaChanges.length}
- **Municípios Criados/Extintos:** +${createdMunicipalities.length} / -${extinctMunicipalities.length}
- **Divergências Identificadas:** ${divergentValues.length}
        `.trim()
      });
    }
  }

  // ==========================================
  // ATLAS-048: Gerenciador de Sequência de Releases
  // ==========================================

  const ATLAS_RELEASE_ROADMAP = Object.freeze([
    "Atlas 1: Proveniência, Geografia e Reconciliação",
    "Atlas 2: População e Domicílios Oficiais por Setor",
    "Atlas 3: Contagem de Escolas e Equipamentos",
    "Atlas 4: PIB Proporcional Populacional",
    "Atlas 5: PIB Residencial e Produtivo",
    "Atlas 6: Impostos Municipais e Federais",
    "Atlas 7: Recursos Públicos e Obras",
    "Atlas 8: Lacuna de Investimento e Balanço Fiscal",
    "Atlas 9: Expansão Internacional (Global Data Mesh)"
  ]);

  class ReleaseSequenceManager {
    static getRoadmap() {
      return ATLAS_RELEASE_ROADMAP;
    }
  }

  // Exports
  exports.InvariantTester = InvariantTester;
  exports.REFERENCE_FIXTURES = REFERENCE_FIXTURES;
  exports.ReferenceFixturesRepository = ReferenceFixturesRepository;
  exports.AtomicPublisher = AtomicPublisher;
  exports.UpdateReportGenerator = UpdateReportGenerator;
  exports.ATLAS_RELEASE_ROADMAP = ATLAS_RELEASE_ROADMAP;
  exports.ReleaseSequenceManager = ReleaseSequenceManager;

})(typeof exports !== 'undefined' ? exports : (globalThis.PublishingSecurityEngine = {}));
