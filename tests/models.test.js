const test = require("node:test");
const assert = require("node:assert/strict");

const modules = {
  AtlasCore: require("../atlas_core.js"),
  DisaggregationModels: require("../disaggregation_models.js"),
  GDPModels: require("../gdp_models.js"),
  FiscalModels: require("../fiscal_models.js"),
  PublicResourcesModels: require("../public_resources_models.js"),
  PointInPolygonPipelineModule: require("../point_in_polygon_pipeline.js"),
  UITransparencyModels: require("../ui_transparency_models.js"),
  PublishingSecurityEngine: require("../publishing_security_engine.js")
};

for (const [name, exported] of Object.entries(modules)) {
  test(`${name} expõe uma API pública`, () => {
    assert.equal(typeof exported, "object");
    assert.ok(Object.keys(exported).length > 0);
  });
}

test("modelo por domicílios conserva exatamente o total inteiro", () => {
  const result = modules.DisaggregationModels.HouseholdsModel.calculate({
    officialParentTotal: 1000,
    sectors: [
      { id: "a", households: 1 },
      { id: "b", households: 1 },
      { id: "c", households: 1 }
    ]
  });
  assert.equal(
    result.sectors.reduce((total, sector) => total + sector.valorTotal, 0),
    1000
  );
});

test("catálogo censitário explicita nível N7 e denominadores de taxas", () => {
  const catalog = modules.AtlasCore.INDICATOR_CATALOG;
  assert.ok(catalog.populacao.officialLevels.includes("N7"));
  assert.equal(catalog.taxa_alfabetizacao_15_mais.denominator, "populacao_15_mais");
  assert.equal(catalog.taxa_alfabetizacao_15_mais.isAdditive, false);
  assert.deepEqual(catalog.taxa_alfabetizacao_15_mais.allowedDisaggregationWeights, []);
});
