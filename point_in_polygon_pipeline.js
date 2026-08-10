/**
 * Atlas Point In Polygon Pipeline - Motor Espacial e Reconciliação de Equipamentos Públicos
 * Release 6 — Cartões ATLAS-037 a ATLAS-039
 */

(function (exports) {
  "use strict";

  const AtlasCore = typeof require !== 'undefined' ? require('./atlas_core.js') : (globalThis.AtlasCore || {});
  const { PROVENANCE_STATES } = AtlasCore;

  // ==========================================
  // ATLAS-037: Pipeline Genérico Ponto-Setor
  // ==========================================

  class PointInPolygonPipeline {
    /**
     * Algoritmo Ray-Casting para verificar se (lng, lat) está dentro de um anel de coordenadas polygon [[lng, lat], ...]
     */
    static isPointInRing(point, ring) {
      const [x, y] = point;
      let inside = false;

      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];

        const intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    /**
     * Atribui uma lista de pontos a um conjunto de setores censitários.
     * Retorna { assignedPoints, qualityQueue }
     */
    static assignPointsToSectors(points = [], sectorFeatures = []) {
      const assigned = [];
      const qualityQueue = [];

      points.forEach(pt => {
        const { id, latitude, longitude, active = true, ...props } = pt;
        if (!active) return; // Ignora desativados/inativos

        const coords = [Number(longitude), Number(latitude)];
        let matchedSector = null;

        for (const feature of sectorFeatures) {
          const sectorId = feature.id || feature.properties.sectorId;
          const geom = feature.geometry;

          if (geom.type === "Polygon") {
            if (this.isPointInRing(coords, geom.coordinates[0])) {
              matchedSector = sectorId;
              break;
            }
          } else if (geom.type === "MultiPolygon") {
            for (const poly of geom.coordinates) {
              if (this.isPointInRing(coords, poly[0])) {
                matchedSector = sectorId;
                break;
              }
            }
            if (matchedSector) break;
          }
        }

        if (matchedSector) {
          assigned.push(Object.freeze({
            pointId: String(id),
            sectorId: String(matchedSector),
            latitude: Number(latitude),
            longitude: Number(longitude),
            assignedMethod: "point_in_polygon_exact",
            ...props
          }));
        } else {
          qualityQueue.push(Object.freeze({
            pointId: String(id),
            latitude: Number(latitude),
            longitude: Number(longitude),
            reason: "fora_das_malhas_setoriais",
            ...props
          }));
        }
      });

      return Object.freeze({
        assignedPoints: Object.freeze(assigned),
        qualityQueue: Object.freeze(qualityQueue)
      });
    }
  }

  // ==========================================
  // ATLAS-038: Contagem de Escolas e Hospitais por Setor
  // ==========================================

  class SchoolHospitalCounter {
    static countBySector(assignedPoints = []) {
      const counts = new Map();

      assignedPoints.forEach(pt => {
        const secId = String(pt.sectorId);
        counts.set(secId, (counts.get(secId) || 0) + 1);
      });

      return Object.freeze({
        getSectorCount(sectorId) {
          return counts.get(String(sectorId)) || 0;
        },
        getAllCounts() {
          return new Map(counts);
        }
      });
    }

    static aggregateHierarchically(sectorCountsMap = new Map(), sectorToNeighborhoodMap = new Map()) {
      const neighborhoodCounts = new Map();

      sectorCountsMap.forEach((count, sectorId) => {
        const nbrName = sectorToNeighborhoodMap.get(sectorId) || "Outros / Não Especificado";
        neighborhoodCounts.set(nbrName, (neighborhoodCounts.get(nbrName) || 0) + count);
      });

      return Object.freeze({
        neighborhoodCounts: Object.freeze(new Map(neighborhoodCounts))
      });
    }
  }

  // ==========================================
  // ATLAS-039: Reconciliação de Contagens de Estabelecimentos
  // ==========================================

  class EstablishmentReconciler {
    static reconcileCounts(params) {
      const {
        establishmentType = "Escolas",
        locatedPointsCount = 0,
        officialMunicipalTotal = 0,
        officialStateTotal = null
      } = params;

      const loc = Number(locatedPointsCount);
      const officialMun = Number(officialMunicipalTotal);
      const unlocatedCount = Math.max(0, officialMun - loc);

      const coveragePercent = officialMun > 0 ? (loc / officialMun) * 100 : 100;

      return Object.freeze({
        establishmentType,
        locatedPointsCount: loc,
        officialMunicipalTotal: officialMun,
        officialStateTotal: officialStateTotal !== null ? Number(officialStateTotal) : null,
        unlocatedCount,
        coveragePercent,
        displayLabel: `${loc} localizadas de ${officialMun} oficiais (${coveragePercent.toFixed(1)}% de cobertura)`,
        notice: unlocatedCount > 0
          ? `Atenção: Exibindo apenas os ${loc} estabelecimentos com geolocalização confirmada. Não são inventadas coordenadas para os ${unlocatedCount} registros restantes.`
          : "100% dos estabelecimentos oficiais estão geolocalizados."
      });
    }
  }

  // Exports
  exports.PointInPolygonPipeline = PointInPolygonPipeline;
  exports.SchoolHospitalCounter = SchoolHospitalCounter;
  exports.EstablishmentReconciler = EstablishmentReconciler;

})(typeof exports !== 'undefined' ? exports : (globalThis.PointInPolygonPipelineModule = {}));
