/**
 * Atlas Core - Módulo de Data Provenance, Catálogos, Reconciliação e Desagregação
 * Release 0 — Fundamentos e proteção contra dados enganosos (ATLAS-001 a ATLAS-005)
 */

(function (exports) {
  "use strict";

  // ==========================================
  // ATLAS-001: Estados de Proveniência do Valor
  // ==========================================
  const PROVENANCE_STATES = Object.freeze({
    OFFICIAL_OBSERVED: "official_observed",
    OFFICIAL_PARENT_CONTEXT: "official_parent_context",
    DERIVED_ROLLUP: "derived_rollup",
    DERIVED_ADAPTED_GEOGRAPHY: "derived_adapted_geography",
    ESTIMATED_PROPORTIONAL: "estimated_proportional",
    ESTIMATED_MODEL: "estimated_model",
    SUPPRESSED: "suppressed",
    UNAVAILABLE: "unavailable",
    NOT_APPLICABLE: "not_applicable"
  });

  const PROVENANCE_METADATA = Object.freeze({
    [PROVENANCE_STATES.OFFICIAL_OBSERVED]: {
      label: "Oficial Observado",
      badgeClass: "provenance-badge-official",
      description: "Dado oficial diretamente publicado pela fonte primária no nível territorial.",
      isOfficial: true,
      isEstimated: false
    },
    [PROVENANCE_STATES.OFFICIAL_PARENT_CONTEXT]: {
      label: "Contexto Pai Oficial",
      badgeClass: "provenance-badge-parent",
      description: "Valor oficial de nível superior (ex: município ou UF) exibido como referência.",
      isOfficial: true,
      isEstimated: false
    },
    [PROVENANCE_STATES.DERIVED_ROLLUP]: {
      label: "Soma Derivada de Filhos",
      badgeClass: "provenance-badge-derived",
      description: "Valor calculado agregando a soma exata dos sub-níveis oficiais.",
      isOfficial: false,
      isEstimated: false
    },
    [PROVENANCE_STATES.DERIVED_ADAPTED_GEOGRAPHY]: {
      label: "Geografia Adaptada",
      badgeClass: "provenance-badge-adapted",
      description: "Dado histórico ou espacial adaptado à malha territorial atual por tabela de correspondência.",
      isOfficial: false,
      isEstimated: true
    },
    [PROVENANCE_STATES.ESTIMATED_PROPORTIONAL]: {
      label: "Estimado Proporcional",
      badgeClass: "provenance-badge-estimated",
      description: "Valor estimado por rateio de peso territorial (população, domicílios, renda, etc).",
      isOfficial: false,
      isEstimated: true
    },
    [PROVENANCE_STATES.ESTIMATED_MODEL]: {
      label: "Modelo Híbrido Estimado",
      badgeClass: "provenance-badge-model",
      description: "Valor estimado por modelo estatístico ou híbrido multi-critério.",
      isOfficial: false,
      isEstimated: true
    },
    [PROVENANCE_STATES.SUPPRESSED]: {
      label: "Sigilo Estatístico",
      badgeClass: "provenance-badge-suppressed",
      description: "Valor omitido na fonte por razões de sigilo ou privacidade.",
      isOfficial: true,
      isEstimated: false
    },
    [PROVENANCE_STATES.UNAVAILABLE]: {
      label: "Dado Ausente",
      badgeClass: "provenance-badge-unavailable",
      description: "Valor não disponível na fonte oficial (distinto do zero numérico).",
      isOfficial: false,
      isEstimated: false
    },
    [PROVENANCE_STATES.NOT_APPLICABLE]: {
      label: "Não Aplicável",
      badgeClass: "provenance-badge-na",
      description: "Métrica não aplicável a esta geografia ou tipo de entidade.",
      isOfficial: false,
      isEstimated: false
    }
  });

  /**
   * Formata e retorna as propriedades de selo/badge de proveniência para a interface.
   */
  function getProvenanceBadge(state) {
    const meta = PROVENANCE_METADATA[state] || PROVENANCE_METADATA[PROVENANCE_STATES.UNAVAILABLE];
    return {
      state,
      label: meta.label,
      badgeClass: meta.badgeClass,
      description: meta.description,
      isOfficial: meta.isOfficial,
      isEstimated: meta.isEstimated
    };
  }

  // ==========================================
  // ATLAS-002: Suporte a Múltiplos Valores e Auditoria
  // ==========================================

  /**
   * Cria um registro de indicador auditável, sem sobrescrita.
   */
  function createIndicatorRecord(params) {
    const {
      indicatorId,
      entityId,
      year,
      officialValue = null,
      childrenRollupValue = null,
      estimatedValue = null,
      expectedChildrenCount = 0,
      actualChildrenCount = 0,
      provenanceState = PROVENANCE_STATES.UNAVAILABLE
    } = params;

    const official = (officialValue !== null && officialValue !== undefined) ? Number(officialValue) : null;
    const rollup = (childrenRollupValue !== null && childrenRollupValue !== undefined) ? Number(childrenRollupValue) : null;
    const estimated = (estimatedValue !== null && estimatedValue !== undefined) ? Number(estimatedValue) : null;

    let differenceAbsolute = null;
    let differencePercent = null;

    if (rollup !== null && official !== null) {
      differenceAbsolute = rollup - official;
      if (official !== 0) {
        differencePercent = (differenceAbsolute / official) * 100;
      }
    } else if (estimated !== null && official !== null) {
      differenceAbsolute = estimated - official;
      if (official !== 0) {
        differencePercent = (differenceAbsolute / official) * 100;
      }
    }

    const coveragePercent = expectedChildrenCount > 0
      ? (actualChildrenCount / expectedChildrenCount) * 100
      : 100;

    return Object.freeze({
      indicatorId,
      entityId,
      year: String(year),
      officialValue: official,
      childrenRollupValue: rollup,
      estimatedValue: estimated,
      differenceAbsolute,
      differencePercent,
      coveragePercent,
      expectedChildrenCount,
      actualChildrenCount,
      provenanceState,
      provenanceBadge: getProvenanceBadge(provenanceState)
    });
  }

  // ==========================================
  // ATLAS-003: Catálogo de Indicadores
  // ==========================================

  const AGGREGATION_METHODS = Object.freeze({
    SUM: "sum",
    WEIGHTED_AVERAGE: "weighted_average",
    NONE: "none"
  });

  const ALLOWED_WEIGHTS = Object.freeze([
    "populacao",
    "domicilios",
    "renda_domiciliar",
    "empregos_massa_salarial",
    "quantidade_tipo_estabelecimentos",
    "imoveis_enderecos",
    "hibrido_configuravel"
  ]);

  const INDICATOR_CATALOG = {
    populacao: Object.freeze({
      id: "populacao",
      name: "População Residente",
      unit: "habitantes",
      isAdditive: true,
      denominator: null,
      officialLevels: ["N1", "N2", "N3", "N6", "N7"],
      aggregationMethod: AGGREGATION_METHODS.SUM,
      allowedDisaggregationWeights: ALLOWED_WEIGHTS,
      preferredSource: "populationIbge",
      reconciliationTolerancePercent: 0.1,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    domicilios: Object.freeze({
      id: "domicilios",
      name: "Total de Domicílios",
      unit: "domicílios",
      isAdditive: true,
      denominator: null,
      officialLevels: ["N1", "N3", "N6", "N7"],
      aggregationMethod: AGGREGATION_METHODS.SUM,
      allowedDisaggregationWeights: ALLOWED_WEIGHTS,
      preferredSource: "populationIbge",
      reconciliationTolerancePercent: 0.1,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    pib_corrente: Object.freeze({
      id: "pib_corrente",
      name: "Produto Interno Bruto (Preços Correntes)",
      unit: "R$",
      isAdditive: true,
      denominator: null,
      officialLevels: ["N1", "N3", "N6"],
      aggregationMethod: AGGREGATION_METHODS.SUM,
      allowedDisaggregationWeights: ALLOWED_WEIGHTS,
      preferredSource: "gdpIbge",
      reconciliationTolerancePercent: 0.5,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    pib_per_capita: Object.freeze({
      id: "pib_per_capita",
      name: "PIB per Capita",
      unit: "R$/hab",
      isAdditive: false,
      denominator: "populacao",
      officialLevels: ["N1", "N3", "N6"],
      aggregationMethod: AGGREGATION_METHODS.WEIGHTED_AVERAGE,
      allowedDisaggregationWeights: ["populacao", "renda_domiciliar"],
      preferredSource: "gdpIbge",
      reconciliationTolerancePercent: 0.5,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    taxa_homicidios: Object.freeze({
      id: "taxa_homicidios",
      name: "Taxa de Homicídios por 100 mil hab.",
      unit: "por 100k hab",
      isAdditive: false,
      denominator: "populacao",
      officialLevels: ["N1", "N3", "N6"],
      aggregationMethod: AGGREGATION_METHODS.WEIGHTED_AVERAGE,
      allowedDisaggregationWeights: ["populacao"],
      preferredSource: "securityBrazil",
      reconciliationTolerancePercent: 1.0,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    idhm: Object.freeze({
      id: "idhm",
      name: "Índice de Desenvolvimento Humano Municipal",
      unit: "índice 0-1",
      isAdditive: false,
      denominator: null,
      officialLevels: ["N1", "N3", "N6"],
      aggregationMethod: AGGREGATION_METHODS.NONE, // Índices não aceitam média simples ou soma
      allowedDisaggregationWeights: [],
      preferredSource: "idhmBrazil",
      reconciliationTolerancePercent: 0.0,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    }),

    contagem_estabelecimentos: Object.freeze({
      id: "contagem_estabelecimentos",
      name: "Quantidade de Estabelecimentos",
      unit: "estabelecimentos",
      isAdditive: true,
      denominator: null,
      officialLevels: ["N1", "N3", "N6"],
      aggregationMethod: AGGREGATION_METHODS.SUM,
      allowedDisaggregationWeights: ALLOWED_WEIGHTS,
      preferredSource: "cnesData",
      reconciliationTolerancePercent: 0.0,
      allowNegative: false,
      secrecyPolicy: "exibir_zero_ou_ausente"
    })
  };

  const CENSUS_SECTOR_INDICATOR_RULES = Object.freeze({
    densidade_populacional: {
      name: "Densidade Populacional",
      unit: "hab./km²",
      denominator: "area_km2"
    },
    media_moradores_domicilio: {
      name: "Média de Moradores por Domicílio Ocupado",
      unit: "moradores/domicílio",
      denominator: "domicilios_ocupados"
    },
    percentual_mulheres: {
      name: "Percentual de Mulheres",
      unit: "%",
      denominator: "populacao"
    },
    percentual_criancas_0_14: {
      name: "Percentual de Pessoas de 0 a 14 Anos",
      unit: "%",
      denominator: "populacao"
    },
    percentual_idosos_60_mais: {
      name: "Percentual de Pessoas com 60 Anos ou Mais",
      unit: "%",
      denominator: "populacao"
    },
    taxa_alfabetizacao_15_mais: {
      name: "Taxa de Alfabetização das Pessoas de 15 Anos ou Mais",
      unit: "%",
      denominator: "populacao_15_mais"
    },
    percentual_abastecimento_rede: {
      name: "Percentual com Abastecimento pela Rede Geral",
      unit: "%",
      denominator: "moradores_domicilios_permanentes"
    },
    percentual_esgoto_rede: {
      name: "Percentual com Esgoto em Rede Geral ou Pluvial",
      unit: "%",
      denominator: "moradores_domicilios_permanentes"
    },
    percentual_lixo_coletado: {
      name: "Percentual com Lixo Coletado",
      unit: "%",
      denominator: "moradores_domicilios_permanentes"
    },
    renda_media_responsavel: {
      name: "Rendimento Médio da Pessoa Responsável",
      unit: "R$/mês",
      denominator: "responsaveis_com_rendimento"
    },
    percentual_indigena: {
      name: "Percentual de Pessoas Indígenas",
      unit: "%",
      denominator: "populacao"
    },
    percentual_quilombola: {
      name: "Percentual de Pessoas Quilombolas",
      unit: "%",
      denominator: "populacao"
    },
    obitos_por_mil_habitantes: {
      name: "Óbitos Informados por Mil Habitantes",
      unit: "por mil hab.",
      denominator: "populacao"
    },
    percentual_via_pavimentada: {
      name: "Percentual de Domicílios em Face com Via Pavimentada",
      unit: "%",
      denominator: "domicilios_entorno"
    },
    percentual_iluminacao_publica: {
      name: "Percentual de Domicílios em Face com Iluminação Pública",
      unit: "%",
      denominator: "domicilios_entorno"
    },
    percentual_calcada: {
      name: "Percentual de Domicílios em Face com Calçada",
      unit: "%",
      denominator: "domicilios_entorno"
    },
    percentual_rampa_cadeirante: {
      name: "Percentual de Domicílios em Face com Rampa para Cadeirante",
      unit: "%",
      denominator: "domicilios_entorno"
    },
    percentual_arborizacao: {
      name: "Percentual de Domicílios em Face com Arborização",
      unit: "%",
      denominator: "domicilios_entorno"
    }
  });

  Object.entries(CENSUS_SECTOR_INDICATOR_RULES).forEach(([id, rule]) => {
    INDICATOR_CATALOG[id] = Object.freeze({
      id,
      name: rule.name,
      unit: rule.unit,
      isAdditive: false,
      denominator: rule.denominator,
      officialLevels: ["N7"],
      aggregationMethod: AGGREGATION_METHODS.WEIGHTED_AVERAGE,
      allowedDisaggregationWeights: [],
      preferredSource: "censoSetoresIbge",
      reconciliationTolerancePercent: 0.1,
      allowNegative: false,
      secrecyPolicy: "preservar_ausencia"
    });
  });

  /**
   * Obtém as regras de um indicador ou lança exceção se desconhecido.
   */
  function getIndicatorMeta(indicatorId) {
    const meta = INDICATOR_CATALOG[indicatorId];
    if (!meta) {
      throw new Error(`Indicador '${indicatorId}' não encontrado no catálogo do Atlas.`);
    }
    return meta;
  }

  // ==========================================
  // ATLAS-004: Catálogo Versionado de Fontes
  // ==========================================

  class SourceCatalog {
    constructor() {
      this.sources = new Map();
    }

    registerSource(source) {
      const {
        id,
        orgao,
        paginaInstitucional,
        urlArquivo,
        anoPeriodo,
        dataPublicacaoDownload,
        checksum,
        licenca,
        versaoLeiaute,
        nivelGeografico,
        universoConceito
      } = source;

      if (!id || !orgao || !urlArquivo) {
        throw new Error("Fonte deve conter id, orgao e urlArquivo obrigatórios.");
      }

      const existing = this.sources.get(id);
      const newVersionRecord = {
        orgao,
        paginaInstitucional,
        urlArquivo,
        anoPeriodo,
        dataPublicacaoDownload,
        checksum,
        licenca,
        versaoLeiaute,
        nivelGeografico,
        universoConceito,
        registeredAt: new Date().toISOString()
      };

      if (existing) {
        // Preserva o histórico de versões anteriores imutável
        const history = [...existing.history, existing.current];
        this.sources.set(id, {
          id,
          current: Object.freeze(newVersionRecord),
          history: Object.freeze(history)
        });
      } else {
        this.sources.set(id, {
          id,
          current: Object.freeze(newVersionRecord),
          history: Object.freeze([])
        });
      }
    }

    getSource(id) {
      return this.sources.get(id) || null;
    }

    getSourceVersionHistory(id) {
      const entry = this.sources.get(id);
      if (!entry) return [];
      return [...entry.history, entry.current];
    }
  }

  const defaultSourceCatalog = new SourceCatalog();

  // Fontes Padrão da Release 0
  defaultSourceCatalog.registerSource({
    id: "populationIbge",
    orgao: "IBGE",
    paginaInstitucional: "https://sidra.ibge.gov.br/tabela/4714",
    urlArquivo: "https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/93/p/2022",
    anoPeriodo: "2022",
    dataPublicacaoDownload: "2023-06-28",
    checksum: "sha256:censo2022_pop_v93",
    licenca: "CC-BY 4.0 / Domínio Público IBGE",
    versaoLeiaute: "v1.0",
    nivelGeografico: "N6 (Município)",
    universoConceito: "População residente recenseada no Censo Demográfico 2022"
  });

  defaultSourceCatalog.registerSource({
    id: "censoSetoresIbge",
    orgao: "IBGE",
    paginaInstitucional: "https://www.ibge.gov.br/estatisticas/sociais/trabalho/22827-censo-demografico-2022.html",
    urlArquivo: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv/",
    anoPeriodo: "2022",
    dataPublicacaoDownload: "2026-05-20",
    checksum: null,
    licenca: "Dados públicos do IBGE",
    versaoLeiaute: "2026-05-20",
    nivelGeografico: "N7 (Setor Censitário)",
    universoConceito: "Agregados do Censo Demográfico 2022 por setor censitário, incluindo população, domicílios, alfabetização, demografia, cor ou raça e PCT."
  });

  defaultSourceCatalog.registerSource({
    id: "censoSetoresRendaIbge",
    orgao: "IBGE",
    paginaInstitucional: "https://www.ibge.gov.br/estatisticas/sociais/trabalho/22827-censo-demografico-2022.html",
    urlArquivo: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/",
    anoPeriodo: "2022",
    dataPublicacaoDownload: "2026-05-08",
    checksum: null,
    licenca: "Dados públicos do IBGE",
    versaoLeiaute: "2026-05-08",
    nivelGeografico: "N7 (Setor Censitário)",
    universoConceito: "Rendimento nominal mensal da pessoa responsável pelos domicílios particulares permanentes ocupados."
  });

  defaultSourceCatalog.registerSource({
    id: "censoSetoresEntornoIbge",
    orgao: "IBGE",
    paginaInstitucional: "https://www.ibge.gov.br/estatisticas/sociais/trabalho/22827-censo-demografico-2022.html",
    urlArquivo: "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/",
    anoPeriodo: "2022",
    dataPublicacaoDownload: "2025-04-17",
    checksum: null,
    licenca: "Dados públicos do IBGE",
    versaoLeiaute: "2025-04-17",
    nivelGeografico: "N7 (Setor Censitário)",
    universoConceito: "Características urbanísticas do entorno dos domicílios selecionados para aplicação do levantamento."
  });

  defaultSourceCatalog.registerSource({
    id: "gdpIbge",
    orgao: "IBGE",
    paginaInstitucional: "https://sidra.ibge.gov.br/tabela/5938",
    urlArquivo: "https://apisidra.ibge.gov.br/values/t/5938/n6/all/v/37/p/2023",
    anoPeriodo: "2023",
    dataPublicacaoDownload: "2024-12-15",
    checksum: "sha256:pib2023_v37",
    licenca: "CC-BY 4.0 / Domínio Público IBGE",
    versaoLeiaute: "v1.0",
    nivelGeografico: "N6 (Município)",
    universoConceito: "Produto Interno Bruto a preços correntes (mil R$)"
  });

  // ==========================================
  // ATLAS-005: Motor de Reconciliação
  // ==========================================

  const RECONCILIATION_CLASSIFICATIONS = Object.freeze({
    CONCILIADO: "conciliado",
    DIFERENCA_ARREDONDAMENTO: "diferenca_arredondamento",
    DIFERENCA_COBERTURA: "diferenca_cobertura",
    DIFERENCA_ANO: "diferenca_ano",
    DIFERENCA_CONCEITUAL: "diferenca_conceitual",
    DIVERGENCIA_NAO_EXPLICADA: "divergencia_nao_explicada"
  });

  class ReconciliationEngine {
    /**
     * Compara a soma dos filhos com o valor oficial do pai sem alterar valores oficiais.
     */
    static reconcile(params) {
      const {
        indicatorId,
        officialParentValue,
        childrenValues,
        expectedChildrenCount,
        parentYear,
        childrenYear
      } = params;

      const meta = getIndicatorMeta(indicatorId);
      const tolerance = meta.reconciliationTolerancePercent || 0.1;

      // Validação de aditividade do catálogo (ATLAS-003)
      if (!meta.isAdditive && meta.aggregationMethod === AGGREGATION_METHODS.NONE) {
        return Object.freeze({
          status: RECONCILIATION_CLASSIFICATIONS.DIFERENCA_CONCEITUAL,
          severity: "warning",
          delta: null,
          deltaPercent: null,
          coveragePercent: 0,
          explanation: `O indicador '${meta.name}' não permite soma ou agregação direta de sub-níveis.`
        });
      }

      const validChildren = childrenValues.filter(v => v !== null && v !== undefined && !isNaN(v));
      const actualCount = validChildren.length;

      const coveragePercent = expectedChildrenCount > 0
        ? (actualCount / expectedChildrenCount) * 100
        : 100;

      if (officialParentValue === null || officialParentValue === undefined || isNaN(officialParentValue)) {
        return Object.freeze({
          status: RECONCILIATION_CLASSIFICATIONS.DIVERGENCIA_NAO_EXPLICADA,
          severity: "warning",
          delta: null,
          deltaPercent: null,
          coveragePercent,
          explanation: "Valor oficial pai ausente para reconciliação."
        });
      }

      const officialParent = Number(officialParentValue);
      const childrenSum = validChildren.reduce((acc, curr) => acc + Number(curr), 0);

      const delta = childrenSum - officialParent;
      const deltaPercent = officialParent !== 0 ? (delta / officialParent) * 100 : 0;
      const absDeltaPercent = Math.abs(deltaPercent);

      let status = RECONCILIATION_CLASSIFICATIONS.CONCILIADO;
      let severity = "info";
      let explanation = "Valores totalmente reconciliados e alinhados dentro da tolerância.";

      if (parentYear && childrenYear && String(parentYear) !== String(childrenYear)) {
        status = RECONCILIATION_CLASSIFICATIONS.DIFERENCA_ANO;
        severity = "warning";
        explanation = `Anos das fontes diferem (Pai: ${parentYear}, Filhos: ${childrenYear}).`;
      } else if (expectedChildrenCount > 0 && actualCount < expectedChildrenCount) {
        status = RECONCILIATION_CLASSIFICATIONS.DIFERENCA_COBERTURA;
        severity = "warning";
        explanation = `Cobertura incompleta de filhos (${actualCount}/${expectedChildrenCount} com dados).`;
      } else if (absDeltaPercent <= tolerance) {
        status = RECONCILIATION_CLASSIFICATIONS.CONCILIADO;
        severity = "info";
        explanation = `Diferença dentro da tolerância do indicador (${absDeltaPercent.toFixed(2)}% <= ${tolerance}%).`;
      } else if (absDeltaPercent <= 0.5) {
        status = RECONCILIATION_CLASSIFICATIONS.DIFERENCA_ARREDONDAMENTO;
        severity = "info";
        explanation = `Pequena variação por arredondamento da fonte (${absDeltaPercent.toFixed(2)}%).`;
      } else {
        status = RECONCILIATION_CLASSIFICATIONS.DIVERGENCIA_NAO_EXPLICADA;
        severity = "error";
        explanation = `Divergência significativa não explicada entre a soma dos filhos e o valor pai (${deltaPercent.toFixed(2)}%).`;
      }

      return Object.freeze({
        indicatorId,
        officialParentValue: officialParent,
        childrenSum,
        delta,
        deltaPercent,
        coveragePercent,
        expectedChildrenCount,
        actualChildrenCount: actualCount,
        status,
        severity,
        explanation
      });
    }
  }

  // ==========================================
  // Motor de Desagregação Setorial (Modelo Proporcional)
  // ==========================================

  class DisaggregationEngine {
    /**
     * Calcula o valor estimado do setor censitário / subdivisão territorial.
     * Fórmula: valor_setor = T * peso_setor / soma_dos_pesos_do_município
     */
    static calculateSectorValue(params) {
      const {
        officialParentTotal,
        sectorWeight,
        totalMunicipalityWeights,
        sectorPopulation = null,
        sectorHouseholds = null,
        sectorAreaKm2 = null,
        weightType = "populacao",
        originalSourceLevel = "N6",
        sourceYear = "2022",
        geographyYear = "2022"
      } = params;

      const T = Number(officialParentTotal || 0);
      const w = Number(sectorWeight || 0);
      const sumW = Number(totalMunicipalityWeights || 0);

      if (sumW <= 0) {
        throw new Error("A soma dos pesos do município deve ser maior que zero.");
      }

      const totalEstimated = (T * w) / sumW;

      const pop = sectorPopulation !== null ? Number(sectorPopulation) : null;
      const dom = sectorHouseholds !== null ? Number(sectorHouseholds) : null;
      const area = sectorAreaKm2 !== null ? Number(sectorAreaKm2) : null;

      const valorPerCapita = (pop !== null && pop > 0) ? totalEstimated / pop : null;
      const valorPorDomicilio = (dom !== null && dom > 0) ? totalEstimated / dom : null;
      const densidadeKm2 = (area !== null && area > 0) ? totalEstimated / area : null;

      const diferencaRelacaoOficialPai = totalEstimated - T;

      const provenanceState = weightType === "hibrido_configuravel"
        ? PROVENANCE_STATES.ESTIMATED_MODEL
        : PROVENANCE_STATES.ESTIMATED_PROPORTIONAL;

      return Object.freeze({
        valorTotal: totalEstimated,
        valorPerCapita,
        valorPorDomicilio,
        densidadeKm2,
        nivelOriginalFonte: originalSourceLevel,
        metodoDistribuicao: `proporcional_peso_${weightType}`,
        indicadorOficialEstimado: provenanceState,
        provenanceBadge: getProvenanceBadge(provenanceState),
        anoFonteEGeografia: `${sourceYear}/${geographyYear}`,
        diferencaRelacaoOficialPai
      });
    }
  }

  // ==========================================
  // ATLAS-006: Convenção de Municípios vs. Geocódigos da Malha
  // ==========================================

  const GEOGRAPHY_CONVENTIONS = Object.freeze({
    OFFICIAL_MUNICIPALITIES_COUNT: 5569,
    DIGITAL_MESH_GEOCIENTRIES_COUNT: 5573,

    SPECIAL_FEATURE_CODES: Object.freeze({
      "5300108": Object.freeze({ name: "Brasília", uf: "DF", type: "federal_district", isMunicipality: false }),
      "2605459": Object.freeze({ name: "Distrito Estadual de Fernando de Noronha", uf: "PE", type: "state_district", isMunicipality: false }),
      "4300001": Object.freeze({ name: "Área Operacional Lagoa dos Patos", uf: "RS", type: "operational_area", isMunicipality: false }),
      "4300002": Object.freeze({ name: "Área Operacional Lagoa Mirim", uf: "RS", type: "operational_area", isMunicipality: false })
    }),

    classifyFeature(code) {
      const normalized = String(code).trim();
      const special = this.SPECIAL_FEATURE_CODES[normalized];
      if (special) {
        return special;
      }
      return Object.freeze({ name: "Município Oficial", uf: "", type: "municipality", isMunicipality: true });
    },

    formatConventionNotice(featuresCount) {
      const count = Number(featuresCount || 0);
      const diff = count - this.OFFICIAL_MUNICIPALITIES_COUNT;
      if (count === this.DIGITAL_MESH_GEOCIENTRIES_COUNT || diff === 4) {
        return `A Malha Municipal Digital do IBGE contém 5.573 geocódigos (5.569 municípios oficiais + 4 áreas especiais: DF, Fernando de Noronha e 2 áreas operacionais).`;
      }
      return `Exibindo ${count} feições territoriais na malha territorial.`;
    }
  });

  // ==========================================
  // ATLAS-007: Gestão da Divisão Territorial Brasileira (DTB)
  // ==========================================

  class DTBManager {
    static detectDTBChanges(oldDTB = [], newDTB = []) {
      const oldMap = new Map(oldDTB.map(item => [String(item.id), item]));
      const newMap = new Map(newDTB.map(item => [String(item.id), item]));

      const created = [];
      const extinct = [];
      const renamed = [];
      const unclassified = [];

      newMap.forEach((item, id) => {
        if (!oldMap.has(id)) {
          created.push(item);
        } else {
          const oldItem = oldMap.get(id);
          if (oldItem.name !== item.name) {
            renamed.push({ id, oldName: oldItem.name, newName: item.name });
          }
        }
        if (item.isUnclassified || item.unclassified || item.type === 'unclassified' || item.status === 'unclassified') {
          unclassified.push(item);
        }
      });

      oldMap.forEach((item, id) => {
        if (!newMap.has(id)) {
          extinct.push(item);
        }
      });

      const blockedPublication = unclassified.length > 0;

      return Object.freeze({
        created,
        extinct,
        renamed,
        unclassifiedCount: unclassified.length,
        blockedPublication,
        summaryText: `DTB Atualizada: ${created.length} criados, ${extinct.length} extintos, ${renamed.length} renomeados. Bloqueio por falta de classificação: ${blockedPublication ? 'SIM' : 'NÃO'}.`
      });
    }
  }

  // ==========================================
  // ATLAS-008: Vigência Temporal dos Territórios
  // ==========================================

  class TerritoryLifecycleManager {
    constructor() {
      this.records = new Map();
    }

    registerLifecycle(params) {
      const {
        territoryId,
        territoryType = "municipality",
        validFrom,
        validTo = null,
        geographyVintage = "2022",
        predecessorIds = [],
        successorIds = [],
        changeType = "creation"
      } = params;

      const record = Object.freeze({
        territoryId: String(territoryId),
        territoryType,
        validFrom: Number(validFrom),
        validTo: validTo !== null ? Number(validTo) : null,
        geographyVintage: String(geographyVintage),
        predecessorIds: Object.freeze([...predecessorIds]),
        successorIds: Object.freeze([...successorIds]),
        changeType
      });

      this.records.set(String(territoryId), record);
      return record;
    }

    isQueryableAtYear(territoryId, year) {
      const record = this.records.get(String(territoryId));
      if (!record) return true; // Se não registrado, assume válido historicamente
      const yr = Number(year);
      if (yr < record.validFrom) return false;
      if (record.validTo !== null && yr > record.validTo) return false;
      return true;
    }
  }

  // ==========================================
  // ATLAS-009: Tabela de Correspondência Territorial (Crosswalk)
  // ==========================================

  class TerritoryCrosswalkTable {
    constructor() {
      this.entries = [];
    }

    registerEntry(entry) {
      const {
        sourceTerritoryId,
        targetTerritoryId,
        areaPercent = 100,
        populationPercent = 100,
        method = "intersecao_espacial_censitaria",
        quality = "alta"
      } = entry;

      const frozenEntry = Object.freeze({
        sourceTerritoryId: String(sourceTerritoryId),
        targetTerritoryId: String(targetTerritoryId),
        areaPercent: Number(areaPercent),
        populationPercent: Number(populationPercent),
        method,
        quality
      });

      this.entries.push(frozenEntry);
      return frozenEntry;
    }

    adaptHistoricalValue(params) {
      const { sourceValue, sourceTerritoryId, targetTerritoryId } = params;
      const match = this.entries.find(e => e.sourceTerritoryId === String(sourceTerritoryId) && e.targetTerritoryId === String(targetTerritoryId));

      const factor = match ? match.populationPercent / 100 : 1.0;
      const adaptedValue = Number(sourceValue) * factor;
      const provenanceState = PROVENANCE_STATES.DERIVED_ADAPTED_GEOGRAPHY;

      return Object.freeze({
        originalValue: Number(sourceValue),
        adaptedValue,
        factorApplied: factor,
        provenanceState,
        provenanceBadge: getProvenanceBadge(provenanceState),
        crosswalkQuality: match ? match.quality : "estimativa_direta"
      });
    }
  }

  // ==========================================
  // ATLAS-010: Tratar Setores como Geografia Censitária
  // ==========================================

  class CensusSectorManager {
    constructor() {
      this.sectorVersions = new Map();
    }

    registerSector(sectorId, censusYear, municipalityId, dtbYear) {
      const key = String(sectorId);
      const record = Object.freeze({
        sectorId: key,
        censusYear: String(censusYear),
        municipalityId: String(municipalityId),
        dtbYear: String(dtbYear),
        isReclassified: String(censusYear) !== String(dtbYear)
      });
      this.sectorVersions.set(key, record);
      return record;
    }

    getSectorVersionInfo(sectorId) {
      return this.sectorVersions.get(String(sectorId)) || null;
    }
  }

  // ==========================================
  // ATLAS-011: Hierarquia de Bairros, Distritos e Subdistritos
  // ==========================================

  const NEIGHBORHOOD_RESOLUTION_PRIORITIES = Object.freeze([
    "official_ibge_aggregate",
    "official_city_hall_mesh",
    "exact_sector_neighborhood_match",
    "estimated_spatial_intersection"
  ]);

  class NeighborhoodDistrictHierarchy {
    static resolveNeighborhood(params) {
      const {
        neighborhoodName,
        availableSources = []
      } = params;

      let selectedMethod = "estimated_spatial_intersection";

      for (const priority of NEIGHBORHOOD_RESOLUTION_PRIORITIES) {
        if (availableSources.includes(priority)) {
          selectedMethod = priority;
          break;
        }
      }

      return Object.freeze({
        neighborhoodName,
        resolutionMethod: selectedMethod,
        isOfficial: selectedMethod.startsWith("official"),
        metadataNote: `Bairro '${neighborhoodName}' delimitado via método: ${selectedMethod}.`
      });
    }
  }

  // Exports
  exports.PROVENANCE_STATES = PROVENANCE_STATES;
  exports.PROVENANCE_METADATA = PROVENANCE_METADATA;
  exports.getProvenanceBadge = getProvenanceBadge;
  exports.createIndicatorRecord = createIndicatorRecord;
  exports.AGGREGATION_METHODS = AGGREGATION_METHODS;
  exports.ALLOWED_WEIGHTS = ALLOWED_WEIGHTS;
  exports.INDICATOR_CATALOG = INDICATOR_CATALOG;
  exports.CENSUS_SECTOR_INDICATOR_RULES = CENSUS_SECTOR_INDICATOR_RULES;
  exports.getIndicatorMeta = getIndicatorMeta;
  exports.SourceCatalog = SourceCatalog;
  exports.defaultSourceCatalog = defaultSourceCatalog;
  exports.RECONCILIATION_CLASSIFICATIONS = RECONCILIATION_CLASSIFICATIONS;
  exports.ReconciliationEngine = ReconciliationEngine;
  exports.DisaggregationEngine = DisaggregationEngine;
  exports.GEOGRAPHY_CONVENTIONS = GEOGRAPHY_CONVENTIONS;
  exports.DTBManager = DTBManager;
  exports.TerritoryLifecycleManager = TerritoryLifecycleManager;
  exports.TerritoryCrosswalkTable = TerritoryCrosswalkTable;
  exports.CensusSectorManager = CensusSectorManager;
  exports.NEIGHBORHOOD_RESOLUTION_PRIORITIES = NEIGHBORHOOD_RESOLUTION_PRIORITIES;
  exports.NeighborhoodDistrictHierarchy = NeighborhoodDistrictHierarchy;

})(typeof exports !== 'undefined' ? exports : (globalThis.AtlasCore = {}));
