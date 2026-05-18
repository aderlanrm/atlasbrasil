(function () {
  "use strict";

  // Proteção contra Clickjacking (Frame-Busting)
  if (window.self !== window.top) {
    window.top.location = window.self.location;
  }


  const LATEST_OFFICIAL_GDP_YEAR = "2023";

  const URLS = {
    mapStyle: "https://tiles.openfreemap.org/styles/liberty",
    fallbackStyle: "https://demotiles.maplibre.org/style.json",
    brazilMesh: "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima",
    statesMesh: "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo%2Bjson&qualidade=minima",
    stateMesh: (stateId) => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${stateId}?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade=minima`,
    statePopulation: "https://apisidra.ibge.gov.br/values/t/4714/n3/all/v/93/p/2022",
    cityPopulation: "https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/93/p/2022",
    gdpBrazil: "https://apisidra.ibge.gov.br/values/t/5938/n1/all/v/37/p/all",
    gdpStates: "https://apisidra.ibge.gov.br/values/t/5938/n3/all/v/37/p/all",
    cityGdpYear: (year) => `https://apisidra.ibge.gov.br/values/t/5938/n6/all/v/37/p/${year === "last/1" || year === "last" ? LATEST_OFFICIAL_GDP_YEAR : year}`,
    municipalityGdpHistory: (cityId) => `https://apisidra.ibge.gov.br/values/t/5938/n6/${cityId}/v/37/p/all`,
    states: "https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome",
    cities: "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
    hdiGlobal: "./data/hdi_global.json?v=" + Date.now(),
    hdiOwid: "./data/hdi_owid.json?v=" + Date.now(),
    idhmBrazil: "./data/idhm_brazil.json?v=" + Date.now(),
    securityGlobal: "./data/security_global.json?v=" + Date.now(),
    securityBrazil: "./data/security_brazil.json?v=" + Date.now(),
    securityBrazilCities: "./data/security_brazil_cities.json?v=" + Date.now(),
    worldMesh: "./data/world_data.geojson?v=" + Date.now()
  };

  const DATA_SOURCE_CATALOG = {
    populationIbge: {
      label: "População",
      shortLabel: "IBGE 2022",
      provider: "IBGE/SIDRA 4714",
      type: "api",
      provenance: "real",
      freshness: "Censo Demográfico 2022",
      url: "https://sidra.ibge.gov.br/tabela/4714",
      quality: "Oficial",
      fields: ["população residente", "UF", "município", "ano 2022"],
      methodology: "Consulta SIDRA tabela 4714, variável 93, nos níveis territoriais N3 (UF) e N6 (município).",
      limitations: ["Retrata a população do Censo 2022; não é estimativa anual corrente.", "Quando a API falha, o app pode usar fallback estadual local para manter a navegação."],
      updatePolicy: "Atualizar tabela, variável ou ano quando o IBGE publicar uma nova base oficial compatível.",
      note: "Dado oficial carregado da API SIDRA, com fallback local para UF."
    },
    gdpIbge: {
      label: "PIB territorial",
      shortLabel: "SIDRA 5938",
      provider: "IBGE/SIDRA 5938",
      type: "api",
      provenance: "real",
      freshness: `Oficial até ${LATEST_OFFICIAL_GDP_YEAR}; anos posteriores são projeções locais`,
      url: "https://sidra.ibge.gov.br/tabela/5938",
      quality: "Oficial com projeção sinalizada",
      fields: ["PIB a preços correntes", "UF", "município", "série histórica"],
      methodology: "Consulta SIDRA tabela 5938, variável 37. O valor vem em mil reais e o app converte para reais.",
      limitations: ["PIB municipal tem defasagem natural de publicação.", "Anos posteriores ao último ano oficial são projeções locais e aparecem marcados como proj."],
      updatePolicy: "Manter LATEST_OFFICIAL_GDP_YEAR alinhado ao último ano publicado pelo SIDRA.",
      note: "Valores oficiais em mil reais convertidos para reais; projeções usam crescimento local estimado."
    },
    ibgeMeshes: {
      label: "Malhas territoriais",
      shortLabel: "Malhas IBGE",
      provider: "IBGE Malhas",
      type: "api",
      provenance: "real",
      freshness: "Geometrias oficiais do IBGE",
      url: "https://servicodados.ibge.gov.br/api/docs/malhas?versao=3",
      quality: "Oficial",
      fields: ["geometria do Brasil", "geometria de UF", "geometria de municípios", "códigos territoriais"],
      methodology: "Consulta à API de Malhas do IBGE, em GeoJSON e qualidade mínima para desempenho no navegador.",
      limitations: ["Qualidade mínima reduz detalhe cartográfico para carregar mais rápido.", "Não deve ser usada como base jurídica/cartorial de limite territorial."],
      updatePolicy: "Usar a versão mais recente da API de Malhas quando houver mudança territorial relevante.",
      note: "Geometrias do Brasil, UF e municípios."
    },
    localWorldJson: {
      label: "Indicadores globais",
      shortLabel: "JSON local",
      provider: "data/world_data.geojson",
      type: "json",
      provenance: "compilado",
      freshness: "Base local versionada no repositório",
      url: "./data/world_data.geojson",
      upstreamLabel: "datasets/geo-countries + RestCountries + World Bank",
      upstreamSources: [
        {
          label: "datasets/geo-countries",
          url: "https://github.com/datasets/geo-countries",
          fields: "geometria e códigos ISO",
          usage: "base geométrica dos países"
        },
        {
          label: "RestCountries",
          url: "https://restcountries.com/",
          fields: "população, área, região e nomes em português",
          usage: "enriquecimento descritivo por país"
        },
        {
          label: "World Bank API",
          url: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD",
          fields: "PIB nominal em US$",
          usage: "indicador econômico global"
        }
      ],
      quality: "Compilado",
      fields: ["geometria", "ISO_A3", "população", "área", "região", "nome em português", "PIB nominal em US$"],
      methodology: "Arquivo gerado por fetch_world_data.py, que baixa a geometria, consulta RestCountries, consulta World Bank e faz merge por código ISO_A3.",
      limitations: ["A precisão depende da atualização de cada fonte original.", "Países sem ISO_A3 compatível podem ficar sem enriquecimento completo.", "O arquivo é local: precisa ser regerado para refletir mudanças nas fontes upstream."],
      updatePolicy: "Reexecutar fetch_world_data.py e revisar o diff do GeoJSON quando quiser atualizar a base global.",
      note: "GeoJSON local gerado por fetch_world_data.py a partir de fontes externas consolidadas."
    },
    hdiGlobalUndp: {
      label: "IDH global",
      shortLabel: "UNDP HDR",
      provider: "UNDP Human Development Report Data Center",
      type: "json",
      provenance: "real",
      freshness: "IDH 2023; série histórica 1990-2023",
      url: "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv",
      upstreamLabel: "UNDP Human Development Report 2025",
      upstreamSources: [
        {
          label: "UNDP HDR Data Center",
          url: "https://hdr.undp.org/data-center/human-development-index",
          fields: "IDH, ranking, ISO3 e série histórica por país",
          usage: "base oficial do IDH global"
        },
        {
          label: "CSV oficial HDR25",
          url: "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv",
          fields: "hdi_1990 a hdi_2023 e hdi_rank_2023",
          usage: "arquivo bruto compactado em data/hdi_global.json"
        }
      ],
      quality: "Oficial",
      fields: ["ISO3", "país", "IDH anual 1990-2023", "ranking IDH 2023", "categoria HDR"],
      methodology: "O arquivo data/hdi_global.json foi gerado a partir do CSV oficial de séries temporais do HDR, mantendo apenas os campos de IDH necessários para mapa, ranking e gráfico.",
      limitations: ["A comparação global usa países com ISO3 compatível no GeoJSON local.", "O ano mais recente disponível nessa base é 2023.", "IDH global e IDHM brasileiro são métricas relacionadas, mas não idênticas metodologicamente."],
      updatePolicy: "Baixar o CSV mais recente do HDR Data Center, regenerar data/hdi_global.json e conferir ano, ranking e cobertura por ISO3.",
      note: "Dado real oficial do UNDP/HDR, carregado no site por JSON local versionado."
    },
    hdiGlobalOwid: {
      label: "IDH global via OWID",
      shortLabel: "OWID/UNDP",
      provider: "Our World in Data",
      type: "json",
      provenance: "compilado",
      freshness: "IDH 2023; série histórica 1990-2023; OWID atualizado em 2025-05-07",
      url: "https://ourworldindata.org/grapher/human-development-index",
      upstreamLabel: "Our World in Data + UNDP Human Development Report 2025",
      upstreamSources: [
        {
          label: "Our World in Data Grapher",
          url: "https://ourworldindata.org/grapher/human-development-index",
          fields: "Entity, Code, Year, Human Development Index e região OWID",
          usage: "CSV processado para data/hdi_owid.json"
        },
        {
          label: "Metadados OWID",
          url: "https://ourworldindata.org/grapher/human-development-index.metadata.json",
          fields: "citação, descrição, atualização e metodologia resumida",
          usage: "auditoria da fonte e explicação da diferença"
        },
        {
          label: "UNDP Human Development Report 2025",
          url: "https://hdr.undp.org/data-center/human-development-index",
          fields: "IDH original",
          usage: "fonte original citada pelo OWID"
        }
      ],
      quality: "Compilado a partir de fonte oficial",
      fields: ["Entity", "Code", "Year", "Human Development Index", "World region according to OWID"],
      methodology: "O arquivo data/hdi_owid.json foi gerado a partir do CSV do Grapher do OWID. O OWID cita UNDP/HDR 2025 como fonte original e aplica processamento menor para padronizar a série no ecossistema OWID.",
      limitations: ["Não é a fonte primária; é uma redistribuição/processamento do OWID sobre dados UNDP.", "Pode ter cobertura ou metadados ligeiramente diferentes do CSV oficial HDR.", "Use UNDP/HDR quando a prioridade for fonte primária; use OWID quando a prioridade for documentação editorial e integração com séries OWID."],
      updatePolicy: "Baixar human-development-index.csv e metadata.json do OWID, regenerar data/hdi_owid.json e revisar latestYear/cobertura.",
      note: "Dado compilado pelo OWID a partir do UNDP/HDR 2025, com metadados editoriais."
    },
    idhmPnudBrazil: {
      label: "IDHM Brasil e UFs",
      shortLabel: "PNUD IDHM",
      provider: "PNUD Brasil, IPEA, FJP e IBGE/PNAD Contínua",
      type: "json",
      provenance: "real",
      freshness: "IDHM anual 2012-2021 para Brasil e UFs",
      url: "https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm",
      upstreamLabel: "Painel IDHM/PNUD + base_de_dados.xlsx",
      upstreamSources: [
        {
          label: "Painel IDHM - PNUD Brasil",
          url: "https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm",
          fields: "metodologia, escopo territorial e base anual",
          usage: "referência metodológica e página pública da fonte"
        },
        {
          label: "base_de_dados.xlsx",
          url: "https://www.undp.org/sites/g/files/zskgke326/files/2023-07/base_de_dados.xlsx",
          fields: "ANO, AGREGACAO, CODIGO, NOME, IDHM, IDHM_L, IDHM_E, IDHM_R, IDHMAD, ESPVIDA, RDPC e GINI",
          usage: "arquivo bruto compactado em data/idhm_brazil.json"
        },
        {
          label: "PNAD Contínua/IBGE",
          url: "https://www.ibge.gov.br/estatisticas/sociais/trabalho/9171-pesquisa-nacional-por-amostra-de-domicilios-continua-mensal.html",
          fields: "insumos demográficos, renda e educação",
          usage: "base estatística usada pelo painel IDHM"
        }
      ],
      quality: "Oficial",
      fields: ["IDHM", "IDHM Longevidade", "IDHM Educação", "IDHM Renda", "IDHMAD", "esperança de vida", "renda per capita", "Gini"],
      methodology: "O arquivo data/idhm_brazil.json foi gerado a partir da planilha oficial do Painel IDHM. O app seleciona o ano ativo e copia IDHM e componentes para Brasil e UFs.",
      limitations: ["A série anual desta planilha cobre Brasil e UFs de 2012 a 2021.", "Não é uma série municipal anual.", "IDHM brasileiro e IDH global não devem ser misturados em ranking único."],
      updatePolicy: "Quando o PNUD publicar nova planilha, substituir data/idhm_pnud_brazil.xlsx, regenerar data/idhm_brazil.json e revisar latestYear/years.",
      note: "Dado real oficial do Painel IDHM, com componentes e série histórica."
    },
    idhmCityProxy: {
      label: "IDHM de cidades",
      shortLabel: "Proxy UF",
      provider: "Cálculo local a partir do IDHM da UF",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado do ano ativo do IDHM estadual",
      quality: "Proxy transparente",
      fields: ["IDHM estadual do ano ativo", "código da UF", "cidade selecionada"],
      methodology: "Como a base anual carregada não traz IDHM municipal, cada cidade recebe temporariamente o IDHM da sua UF para permitir navegação e comparação visual dentro do mapa.",
      limitations: ["Não é IDHM municipal real.", "Não deve ser usado para ranking municipal, tomada de decisão local ou comparação entre cidades.", "O Atlas Brasil possui IDHM municipal em anos censitários, mas essa base ainda não foi integrada nesta versão."],
      updatePolicy: "Substituir este proxy por uma base municipal auditável, informando anos censitários, arquivo bruto, campos usados e script de normalização.",
      note: "Marcado como estimado para evitar falsa precisão em cidades."
    },
    securityGlobalUnodc: {
      label: "Homicídios globais",
      shortLabel: "UNODC",
      provider: "UNODC / Global Study on Homicide",
      type: "json",
      provenance: "real",
      freshness: "UNODC 2022-2023 consolidated",
      url: "https://dataunodc.un.org/data/crime/cts-intentional-homicide",
      quality: "Oficial com fallback local",
      fields: ["ISO3", "homicide rate per 100k", "ano de referência"],
      methodology: "Taxa de homicídios intencionais por 100 mil habitantes compilada do UNODC Global Study on Homicide.",
      limitations: ["Conjunto fallback com países selecionados.", "Algumas taxas refletem anos de referência diferentes (2021-2023).", "Países sem dados ficam sem valor no mapa."],
      updatePolicy: "Baixar CSV oficial do UNODC Data Portal e regenerar data/security_global.json.",
      note: "Dado real oficial do UNODC; fallback local usado para cobertura inicial."
    },
    securityGlobalGpi: {
      label: "Global Peace Index",
      shortLabel: "GPI",
      provider: "Vision of Humanity / IEP",
      type: "json",
      provenance: "real",
      freshness: "GPI 2024",
      url: "https://visionofhumanity.org",
      quality: "Oficial com fallback local",
      fields: ["ISO3", "GPI Score", "GPI Rank"],
      methodology: "Global Peace Index (GPI) mede a paz relativa de nações usando indicadores de criminalidade, terrorismo, militarização e conflitos. Escala 1-5 (1 = mais pacífico, 5 = menos pacífico).",
      limitations: ["Conjunto fallback com países selecionados.", "GPI é composto por múltiplos indicadores, não apenas violência letal.", "Países sem dados ficam sem valor no mapa."],
      updatePolicy: "Baixar planilha oficial do Vision of Humanity e regenerar data/security_global.json.",
      note: "Dado real do Institute for Economics & Peace."
    },
    securityBrazilFBSP: {
      label: "Segurança Pública Brasil",
      shortLabel: "FBSP/IPEA",
      provider: "FBSP Anuário Brasileiro / IPEA Atlas da Violência",
      type: "json",
      provenance: "real",
      freshness: "FBSP Anuário 2024 (dados 2023)",
      url: "https://forumseguranca.org.br",
      quality: "Oficial",
      fields: ["UF", "MVI por 100k", "Roubo Veículos por 100k", "Feminicídio por 100k", "Violência Doméstica por 100k", "ano-base"],
      methodology: "MVI = homicídio doloso + latrocínio + lesão corporal seguida de morte + mortes por intervenção policial. Roubo de veículos = roubo + furto. Feminicídio e violência doméstica baseados em registros policiais e consolidados oficiais.",
      limitations: ["Dados estaduais do Anuário FBSP 2024 (ano-base 2023).", "Violência doméstica pode ter subnotificação regional.", "Divergências esperadas entre FBSP (polícia) e Atlas da Violência (SUS/óbito)."],
      updatePolicy: "Baixar nova planilha do Anuário FBSP e regenerar data/security_brazil.json.",
      note: "Dado real oficial do FBSP e IPEA."
    },
    securityBrazilIPEACities: {
      label: "Homicídios municipais",
      shortLabel: "IPEA Atlas",
      provider: "IPEA Atlas da Violência / SIM-SUS",
      type: "json",
      provenance: "real",
      freshness: "Atlas da Violência 2022",
      url: "https://ipea.gov.br/atlasviolencia",
      quality: "Oficial com cobertura parcial",
      fields: ["código IBGE", "homicídios por 100k", "ano"],
      methodology: "Taxa de homicídios por 100 mil habitantes calculada a partir do Sistema de Informações sobre Mortalidade (SIM) do Ministério da Saúde, via IPEA Atlas da Violência.",
      limitations: ["Cobertura parcial: ~100 municípios principais e capitais.", "Municípios sem dado usam proxy pela UF.", "Divergências esperadas entre FBSP (polícia) e Atlas (SUS/óbito)."],
      updatePolicy: "Baixar tabelas oficiais do IPEA Atlas e regenerar data/security_brazil_cities.json.",
      note: "Dado real do IPEA; cobertura parcial no MVP."
    },
    securityBrazilCityProxy: {
      label: "Segurança de cidades (Proxy)",
      shortLabel: "Proxy UF",
      provider: "Cálculo local a partir do estado",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado da UF",
      quality: "Proxy transparente",
      fields: ["indicador estadual ativo", "código da UF", "cidade selecionada"],
      methodology: "Quando não há dado municipal real do IPEA, a cidade recebe o indicador da sua UF para permitir navegação visual.",
      limitations: ["Não é dado municipal real.", "Não deve ser usado para ranking municipal ou tomada de decisão local.", "Prioridade é dada ao dado IPEA quando disponível."],
      updatePolicy: "Substituir por base municipal auditável quando disponível.",
      note: "Fallback transparente quando IPEA não cobre o município."
    },
    politicsEstimate: {
      label: "Representação política",
      shortLabel: "Estimativa",
      provider: "Regras constitucionais e cálculos locais",
      type: "computed",
      provenance: "estimado",
      freshness: "Calculado no navegador",
      quality: "Estimativa transparente",
      fields: ["cargos executivos", "deputados federais", "senadores", "deputados estaduais/distritais", "teto estimado de vereadores"],
      methodology: "Cálculos locais combinam população, regras fixas de representação e tetos constitucionais por faixa populacional.",
      limitations: ["Não substitui base oficial de mandato, folha pública ou composição atualizada por eleição.", "Folha pública está marcada como fonte pendente."],
      updatePolicy: "Trocar por fonte oficial quando houver endpoint confiável para cargos, mandatos e folha por ente federativo.",
      note: "Cargos e tetos por população; folha pública ainda depende de fonte oficial por ente."
    },
    enemLocal: {
      label: "Educação/ENEM",
      shortLabel: "ENEM local",
      provider: "Tabela local em app.js",
      type: "json",
      provenance: "misto",
      freshness: "Estados em tabela local; municípios projetados",
      quality: "Misto/provisório",
      fields: ["média ENEM por UF", "áreas nacionais", "estimativa municipal projetada"],
      methodology: "Estados usam série local em app.js. Municípios são estimados a partir da média estadual e fatores simplificados.",
      limitations: ["Municípios não são microdados oficiais nesta versão.", "Usar apenas como leitura exploratória até integrar microdados oficiais auditáveis."],
      updatePolicy: "Ao importar microdados oficiais do INEP, registrar arquivo, ano, filtro, agregação e script de processamento.",
      note: "Use como série local. Ao importar microdados oficiais, marque os novos datasets como real."
    },
    travelCurated: {
      label: "Viajando o Brasil",
      shortLabel: "Curadoria",
      provider: "Curadoria manual",
      type: "manual",
      provenance: "curado",
      freshness: "Atualizado por edição do catálogo",
      quality: "Curadoria manual",
      fields: ["cidade", "URL do vídeo", "título", "canal"],
      methodology: "Lista manual mantida em DOCUMENTED_CITIES, usada para destacar cidades com documentários.",
      limitations: ["Cobertura depende de curadoria; ausência de vídeo não significa ausência de conteúdo público sobre a cidade."],
      updatePolicy: "Adicionar novas cidades com URL, título, canal e checagem manual do link.",
      note: "Lista manual de cidades com documentário e metadados de vídeo."
    }
  };

  const ANALYSIS_CATALOG = {
    general: {
      label: "Geral",
      caption: "Visão geral",
      icon: "layout-dashboard",
      group: "primary",
      title: "População e leitura territorial geral",
      defaultMetric: "population",
      sourceIds: ["populationIbge", "gdpIbge", "politicsEstimate", "ibgeMeshes"],
      note: "Visão geral combina população oficial, PIB oficial/projetado e indicadores calculados."
    },
    gdp: {
      label: "PIB",
      caption: "PIB e riqueza",
      icon: "landmark",
      group: "primary",
      title: "Mapa de calor de PIB e PIB por habitante",
      defaultMetric: "perCapita",
      metricStateKey: "gdpSubMetric",
      sourceIds: ["gdpIbge", "populationIbge"],
      note: "PIB territorial vem do SIDRA/IBGE 5938. PIB por habitante divide o PIB pela população do território.",
      metrics: {
        perCapita: { label: "PIB/Hab.", metric: "PIB por habitante", sourceIds: ["gdpIbge", "populationIbge"] },
        total: { label: "PIB Total", metric: "PIB total", sourceIds: ["gdpIbge"] }
      }
    },
    hdi: {
      label: "IDH",
      caption: "IDH e IDHM",
      icon: "activity",
      group: "primary",
      title: "Desenvolvimento humano no mundo, Brasil, estados e cidades",
      defaultMetric: "hdi",
      sourceIds: ["hdiGlobalUndp", "idhmPnudBrazil", "idhmCityProxy"],
      sourceOptions: [
        {
          id: "undp",
          label: "UNDP/HDR",
          scope: ["world"],
          sourceIds: ["hdiGlobalUndp"],
          difference: "Fonte primária oficial do Human Development Report; melhor opção para auditoria direta do IDH global."
        },
        {
          id: "owid",
          label: "Our World in Data",
          scope: ["world"],
          sourceIds: ["hdiGlobalOwid"],
          difference: "Redistribuição do OWID com processamento menor e metadados editoriais; a fonte original citada continua sendo UNDP/HDR 2025."
        }
      ],
      note: "No Globo, usa IDH global oficial do UNDP/HDR. No Brasil e UFs, usa IDHM anual do Painel IDHM/PNUD. Em cidades, a camada aparece como proxy pela UF até integrar uma base municipal auditável."
    },
    politics: {
      label: "Política",
      caption: "Política",
      icon: "scale",
      group: "primary",
      title: "Representação política e folha pública em preparação",
      defaultMetric: "peoplePerPolitician",
      sourceIds: ["politicsEstimate", "populationIbge"],
      note: "Dados políticos são estimados por cargos e tetos constitucionais. Folha pública depende de fonte oficial por ente."
    },
    education: {
      label: "Educação",
      caption: "Educação",
      icon: "graduation-cap",
      group: "primary",
      title: "Escolas e formação em preparação",
      defaultMetric: "enemScore",
      sourceIds: ["enemLocal"],
      note: "Estados usam tabela local de ENEM. Municípios mostram estimativa projetada a partir da média estadual e fatores socioeconômicos."
    },
    security: {
      label: "Segurança",
      caption: "Segurança pública",
      icon: "shield",
      group: "primary",
      title: "Violência letal e indicadores de segurança pública",
      defaultMetric: "mviRate",
      metricStateKey: "securitySubMetric",
      sourceIds: ["securityGlobalUnodc", "securityBrazilFBSP"],
      sourceOptions: [
        {
          id: "unodc",
          label: "UNODC",
          scope: ["world"],
          sourceIds: ["securityGlobalUnodc"],
          difference: "Taxa de homicídios intencionais por 100k habitantes. Métrica universal de violência letal."
        },
        {
          id: "gpi",
          label: "GPI",
          scope: ["world"],
          sourceIds: ["securityGlobalGpi"],
          difference: "Global Peace Index mede paz multidimensional (criminalidade, terrorismo, militarização). Escala 1-5; menor = mais pacífico."
        }
      ],
      metrics: {
        mviRate: { label: "MVI", metric: "MVI por 100k", sourceIds: ["securityBrazilFBSP"] },
        vehicleTheftRate: { label: "Roubo Veículos", metric: "Roubo veículos por 100k", sourceIds: ["securityBrazilFBSP"] },
        femicideRate: { label: "Feminicídio", metric: "Feminicídio por 100k", sourceIds: ["securityBrazilFBSP"] },
        domesticViolenceRate: { label: "Violência Doméstica", metric: "Violência doméstica por 100k", sourceIds: ["securityBrazilFBSP"] }
      },
      note: "No Globo, alterna entre homicídios (UNODC) e Global Peace Index. No Brasil e UFs, alterna entre MVI, roubos de veículos, feminicídio e violência doméstica (FBSP). Em cidades, prioriza dados reais do IPEA Atlas; quando ausente, usa proxy pela UF."
    },
    travel: {
      label: "Viajando o Brasil",
      caption: "Viajando o Brasil",
      icon: "map-pin",
      group: "explore",
      title: "Cidades e estados documentados em vídeo",
      defaultMetric: "documentedCities",
      sourceIds: ["travelCurated"],
      note: "Camada curada manualmente para cidades e estados com documentários em vídeo."
    }
  };

  const WORLD_METRIC_CATALOG = {
    pop: { label: "População", metric: "População", sourceIds: ["localWorldJson"], labels: ["<1mi", "10mi", "50mi", "200mi", "1bi+"] },
    area: { label: "Área territorial", metric: "Área territorial", sourceIds: ["localWorldJson"], labels: ["Pequeno", "Médio", "Grande", "Gigante", "Continental"] },
    density: { label: "Densidade pop.", metric: "Densidade pop.", sourceIds: ["localWorldJson"], labels: ["<10", "50", "150", "500", "1000+"] },
    gdp: { label: "PIB", metric: "PIB US$ (2024)", sourceIds: ["localWorldJson"], labels: ["<10bi", "100bi", "500bi", "2tri", "10tri+"] },
    gdpPerCapita: { label: "PIB per capita", metric: "PIB per capita US$ (24)", sourceIds: ["localWorldJson"], labels: ["<2k", "5k", "15k", "35k", "60k+"] }
  };

  const STORAGE_KEY = "atlas-brasil-preferences-v1";
  const DATA_CACHE_NAME = "atlas-brasil-official-data-2023-v1";
  const savedPreferences = readStoredPreferences();
  const savedCamera = normalizeCamera(savedPreferences.camera);

  const FEDERAL_DEPUTIES_BY_UF = {
    AC: 8, AL: 9, AM: 8, AP: 8, BA: 39, CE: 22, DF: 8, ES: 10, GO: 17,
    MA: 18, MG: 53, MS: 8, MT: 8, PA: 17, PB: 12, PE: 25, PI: 10,
    PR: 30, RJ: 46, RN: 8, RO: 8, RR: 8, RS: 31, SC: 16, SE: 8,
    SP: 70, TO: 8
  };

  const NATIONAL_EXECUTIVE = {
    president: "Luiz Inácio Lula da Silva",
    vicePresident: "Geraldo Alckmin"
  };

  const STATE_FALLBACK = [
    { id: "12", sigla: "AC", nome: "Acre", regiao: "Norte", pop: 830018, lng: -70.55, lat: -8.77 },
    { id: "27", sigla: "AL", nome: "Alagoas", regiao: "Nordeste", pop: 3127511, lng: -36.65, lat: -9.62 },
    { id: "16", sigla: "AP", nome: "Amapá", regiao: "Norte", pop: 733759, lng: -51.8, lat: 1.41 },
    { id: "13", sigla: "AM", nome: "Amazonas", regiao: "Norte", pop: 3941613, lng: -63, lat: -4 },
    { id: "29", sigla: "BA", nome: "Bahia", regiao: "Nordeste", pop: 14141626, lng: -41.7, lat: -12.5 },
    { id: "23", sigla: "CE", nome: "Ceará", regiao: "Nordeste", pop: 8794957, lng: -39.3, lat: -5.2 },
    { id: "53", sigla: "DF", nome: "Distrito Federal", regiao: "Centro-Oeste", pop: 2817068, lng: -47.86, lat: -15.79 },
    { id: "32", sigla: "ES", nome: "Espírito Santo", regiao: "Sudeste", pop: 3833486, lng: -40.3, lat: -19.6 },
    { id: "52", sigla: "GO", nome: "Goiás", regiao: "Centro-Oeste", pop: 7055228, lng: -49.8, lat: -16 },
    { id: "21", sigla: "MA", nome: "Maranhão", regiao: "Nordeste", pop: 6775152, lng: -45.2, lat: -5 },
    { id: "51", sigla: "MT", nome: "Mato Grosso", regiao: "Centro-Oeste", pop: 3658649, lng: -55.9, lat: -12.6 },
    { id: "50", sigla: "MS", nome: "Mato Grosso do Sul", regiao: "Centro-Oeste", pop: 2757013, lng: -54.8, lat: -20.5 },
    { id: "31", sigla: "MG", nome: "Minas Gerais", regiao: "Sudeste", pop: 20539989, lng: -44.5, lat: -18.5 },
    { id: "15", sigla: "PA", nome: "Pará", regiao: "Norte", pop: 8121025, lng: -52, lat: -5.5 },
    { id: "25", sigla: "PB", nome: "Paraíba", regiao: "Nordeste", pop: 3974495, lng: -36.7, lat: -7.1 },
    { id: "41", sigla: "PR", nome: "Paraná", regiao: "Sul", pop: 11444380, lng: -51.5, lat: -24.7 },
    { id: "26", sigla: "PE", nome: "Pernambuco", regiao: "Nordeste", pop: 9058155, lng: -37.9, lat: -8.3 },
    { id: "22", sigla: "PI", nome: "Piauí", regiao: "Nordeste", pop: 3269200, lng: -42.8, lat: -7.7 },
    { id: "33", sigla: "RJ", nome: "Rio de Janeiro", regiao: "Sudeste", pop: 16055174, lng: -42.7, lat: -22.2 },
    { id: "24", sigla: "RN", nome: "Rio Grande do Norte", regiao: "Nordeste", pop: 3302406, lng: -36.5, lat: -5.8 },
    { id: "43", sigla: "RS", nome: "Rio Grande do Sul", regiao: "Sul", pop: 10882965, lng: -53.2, lat: -30 },
    { id: "11", sigla: "RO", nome: "Rondônia", regiao: "Norte", pop: 1581196, lng: -63.4, lat: -10.9 },
    { id: "14", sigla: "RR", nome: "Roraima", regiao: "Norte", pop: 636303, lng: -61.3, lat: 2 },
    { id: "42", sigla: "SC", nome: "Santa Catarina", regiao: "Sul", pop: 7610361, lng: -50, lat: -27.2 },
    { id: "35", sigla: "SP", nome: "São Paulo", regiao: "Sudeste", pop: 44411238, lng: -48.4, lat: -22.2 },
    { id: "28", sigla: "SE", nome: "Sergipe", regiao: "Nordeste", pop: 2209558, lng: -37.4, lat: -10.6 },
    { id: "17", sigla: "TO", nome: "Tocantins", regiao: "Norte", pop: 1511459, lng: -48.3, lat: -10.2 }
  ];

  const ENEM_HISTORY_SCORES = {
    "2025": {
      MG: 573.1, SP: 571.3, DF: 568.1, SC: 567.8, RJ: 565.2,
      ES: 564.0, RS: 561.9, PR: 559.1, RN: 548.5, GO: 547.2,
      PE: 546.0, SE: 544.1, MS: 543.5, PB: 543.0, CE: 541.2,
      RR: 539.5, MT: 538.1, BA: 537.4, AL: 537.1, PI: 535.2,
      TO: 531.0, RO: 530.1, AC: 524.5, PA: 523.8, MA: 522.4,
      AP: 519.5, AM: 514.0
    },
    "2024": {
      MG: 568.5, SP: 566.2, DF: 564.0, SC: 562.1, RJ: 560.8,
      ES: 559.2, RS: 557.5, PR: 555.0, RN: 543.2, GO: 542.0,
      PE: 540.8, SE: 539.1, MS: 538.0, PB: 537.5, CE: 535.8,
      RR: 534.2, MT: 533.0, BA: 532.1, AL: 531.8, PI: 530.2,
      TO: 526.5, RO: 525.0, AC: 519.8, PA: 518.2, MA: 517.5,
      AP: 514.2, AM: 509.8
    },
    "2023": {
      MG: 561.2, SP: 559.1, DF: 557.8, SC: 555.4, RJ: 554.0,
      ES: 552.1, RS: 550.8, PR: 548.5, RN: 538.1, GO: 536.8,
      PE: 535.4, SE: 534.2, MS: 533.1, PB: 532.8, CE: 531.0,
      RR: 529.5, MT: 528.2, BA: 527.1, AL: 526.4, PI: 524.8,
      TO: 521.2, RO: 520.1, AC: 515.2, PA: 513.8, MA: 512.1,
      AP: 509.4, AM: 505.2
    }
  };

  const BRAZIL_ENEM_SCORE = 551;
  const ENEM_AREAS_YEAR = 2025;
  const ENEM_STATES_YEAR = 2025;
  const BRAZIL_ENEM_AREAS = { linguagens: 531, matematica: 535, humanas: 522, natureza: 501, redacao: 672 };
  const availableEnemYears = ["2025", "2024", "2023"];
  let activeEnemYear = "2025";


  const DOCUMENTED_CITIES = {
    "4300646": { n: "Ametista do Sul", v: "https://www.youtube.com/watch?v=EmYJPuVumZA", t: "A CIDADE SUBTERRÂNEA | Ametista do Sul [DOCUMENTÁRIO]", c: "Diogo Elzinga" }
  };

  const BR_CENTER = [-53.2, -10.8];
  const BR_BOUNDS = [[-74.4, -34.2], [-33.7, 5.5]];
  const stateById = new Map();
  const stateFeatureById = new Map();
  const cityById = new Map();
  const cityPopById = new Map();
  const stateCitiesCache = new Map();
  const elements = {};
  const BRASILIA_STREET_CENTER = [-47.8825, -15.7942];

  let map;
  let selectedStateId = null;
  let selectedCityId = null;
  let selectedCityFeature = null;
  let fixedPopup = null;
  let brazilClickTimer = null;
  let stateClickTimer = null;
  let hoverPopup = null;
  let hoveredFeatureKey = null;
  let isStreetMode = false;
  let brazilMeshFeature = null;
  let hoverCardsEnabled = savedPreferences.hoverCards !== false;
  let totalPopulation = 0;
  let brazilGdp = 0;
  let brazilGdpYear = "";
  let activeGdpYear = "last";
  let currentFixedCard = null;
  let availableGdpYears = [];
  let brazilGdpHistory = {};
  let hdiGlobalData = null;
  let hdiOwidData = null;
  let idhmBrazilData = null;
  let activeHdiYear = savedPreferences.hdiYear || "last";
  let availableBrazilHdiYears = [];
  let brazilHdiHistory = {};
  let securityGlobalData = null;
  let securityBrazilData = null;
  let securityBrazilCitiesData = null;
  let activeSecuritySubMetric = savedPreferences.securitySubMetric || "mviRate";
  let activeSourceSelections = { ...(savedPreferences.sourceSelections || {}) };
  let fallbackStyleTried = false;
  let activeBaseMode = validBaseMode(savedPreferences.base) ? savedPreferences.base : "hybrid";
  let activeProjection = validProjection(savedPreferences.projection) ? savedPreferences.projection : "globe";
  let activeView = validView(savedPreferences.view) ? savedPreferences.view : "brazil";
  let activeAnalysis = validAnalysis(savedPreferences.analysis) ? savedPreferences.analysis : "general";
  let activeGdpSubMetric = savedPreferences.gdpSubMetric || "perCapita";
  let activeWorldMetric = validWorldMetric(savedPreferences.worldMetric) ? savedPreferences.worldMetric : "pop";
  let dataCacheStats = createDataCacheStats();
  let basePaintByLayer = new Map();
  let worldFeatureCollection = null;
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    renderAnalysisControls();
    if (window.lucide) window.lucide.createIcons();

    if (typeof maplibregl === "undefined") {
      showStatus("MapLibre não carregou", "Verifique a conexão com cdn.jsdelivr.net para abrir o mapa.", true);
      return;
    }

    initMap();
    bindControls();
    applyPreferenceControls();
    loadAtlas();
  }

  function cacheElements() {
    [
      "status", "status-spinner", "status-title", "status-text", "fixed-detail-card", "hud-layer", "hud-source", "hud-zoom", "hud-coords",
      "heat-legend",
      "metric-br-pop", "metric-city-count", "metric-state", "metric-state-pop", "metric-city", "metric-city-pop",
      "analysis-caption", "data-state-label", "search", "search-results", "selected-code", "selected-type", "selected-name",
      "selected-pop", "selected-share", "selected-area", "selected-density", "selected-rank", "selected-context", "hover-cards-toggle", "population-chart", "chart-title",
      "chart-caption", "ranking", "ranking-title", "ranking-caption", "general-caption", "general-grid", "general-note",
      "analysis-primary-nav", "analysis-explore-nav"
    ].forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  function renderAnalysisControls() {
    document.querySelectorAll("[data-analysis-nav]").forEach((container) => {
      const group = container.dataset.analysisNav;
      const analyses = Object.entries(ANALYSIS_CATALOG).filter(([, config]) => config.group === group);
      container.innerHTML = analyses.map(([id, config]) => `
        <button type="button" data-analysis="${escapeHtml(id)}" ${id === activeAnalysis ? "class=\"active\"" : ""} title="${escapeHtml(config.title || config.label)}">
          <i data-lucide="${escapeHtml(config.icon || "circle")}"></i>${escapeHtml(config.label)}
        </button>
      `).join("");
    });
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: URLS.mapStyle,
      center: savedCamera ? savedCamera.center : [-30, 0],
      zoom: savedCamera ? savedCamera.zoom : 1.7,
      pitch: savedCamera ? savedCamera.pitch : 0,
      bearing: savedCamera ? savedCamera.bearing : 0,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (map.doubleClickZoom) map.doubleClickZoom.disable();

    map.on("error", (event) => {
      const message = String(event.error && event.error.message ? event.error.message : "");
      if (!fallbackStyleTried && /style|tile|network|fetch/i.test(message)) {
        fallbackStyleTried = true;
        map.setStyle(URLS.fallbackStyle);
      }
    });

    map.on("styleimagemissing", (event) => {
      if (!map.hasImage(event.id)) {
        map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });

    map.on("style.load", () => {
      basePaintByLayer = new Map();
      try { map.setProjection({ type: activeProjection }); } catch (error) { console.warn(error); }
      addBaseLayers();
      ensureAtlasLayers();
      setBaseMode(activeBaseMode);
    });

    map.on("move", updateHud);
    map.on("zoom", updateHud);
    map.on("moveend", savePreferences);
    updateHud();
  }

  async function loadAtlas() {
    dataCacheStats = createDataCacheStats();
    showStatus("Carregando dados oficiais", "Buscando cache local e, se faltar, IBGE/SIDRA.");
    seedFallbackStates();

    const requests = await Promise.allSettled([
      fetchJson(URLS.statePopulation),
      fetchJson(URLS.cityPopulation),
      fetchJson(URLS.gdpBrazil),
      fetchJson(URLS.gdpStates),
      fetchJson(URLS.cityGdpYear("last/1")),
      fetchJson(URLS.states),
      fetchJson(URLS.cities),
      fetchJson(URLS.hdiGlobal).catch((error) => {
        console.warn("Falha ao carregar IDH global.", error);
        return null;
      }),
      fetchJson(URLS.hdiOwid).catch((error) => {
        console.warn("Falha ao carregar IDH OWID.", error);
        return null;
      }),
      fetchJson(URLS.idhmBrazil).catch((error) => {
        console.warn("Falha ao carregar IDHM Brasil.", error);
        return null;
      }),
      fetchJson(URLS.securityGlobal).catch((error) => {
        console.warn("Falha ao carregar dados globais de segurança.", error);
        return null;
      }),
      fetchJson(URLS.securityBrazil).catch((error) => {
        console.warn("Falha ao carregar dados de segurança do Brasil.", error);
        return null;
      }),
      fetchJson(URLS.securityBrazilCities).catch((error) => {
        console.warn("Falha ao carregar dados municipais de segurança.", error);
        return null;
      }),
      fetchJson(URLS.brazilMesh).catch((error) => {
        console.warn("Falha ao carregar malha nacional do Brasil.", error);
        return null;
      }),
      fetchJson(URLS.statesMesh)
    ]);

    const [stateRows, cityRows, gdpBrazilRows, gdpStateRows, gdpCityRows, states, cities, hdiGlobalRows, hdiOwidRows, idhmBrazilRows, securityGlobalRows, securityBrazilRows, securityBrazilCitiesRows, brazilMesh, statesMesh] = requests.map((result) => (
      result.status === "fulfilled" ? result.value : null
    ));

    mergeStates(states);
    mergePopulation(stateRows, stateById);
    mergeCities(cities);
    mergeCityPopulation(cityRows);
    mergeBrazilGdp(gdpBrazilRows);
    mergeGdp(gdpStateRows, stateById);
    mergeGdp(gdpCityRows, cityById);
    mergeGlobalHdi(hdiGlobalRows);
    mergeOwidHdi(hdiOwidRows);
    mergeBrazilHdi(idhmBrazilRows);
    mergeSecurityGlobal(securityGlobalRows);
    mergeSecurityBrazil(securityBrazilRows);
    mergeSecurityBrazilCities(securityBrazilCitiesRows);
    hydrateBrazilMesh(brazilMesh);
    hydrateStatesMesh(statesMesh);
    syncHdiToActiveYear();
    syncSecurityData();

    // Apply projections after all data is merged
    mockGdpProjections(brazilGdpHistory);
    stateById.forEach(state => {
      if (state.gdpHistory) mockGdpProjections(state.gdpHistory);
    });
    cityById.forEach(city => {
      if (city.gdpHistory) mockGdpProjections(city.gdpHistory);
    });

    availableGdpYears = Object.keys(brazilGdpHistory).sort((a, b) => b.localeCompare(a));
    if (activeGdpYear === "last" && availableGdpYears.length) activeGdpYear = availableGdpYears[0];
    syncGdpToActiveYear();

    const failedRequests = requests.filter((result) => result.status === "rejected");
    if (failedRequests.length) {
      console.warn("Algumas consultas falharam.", failedRequests.map((result) => result.reason));
      elements["data-state-label"].textContent = "dados parciais";
      showStatus("Dados parciais", "Não foi possível completar todas as consultas. A camada estadual de referência continua disponível.", true);
      setTimeout(hideStatus, 4200);
    } else {
      elements["data-state-label"].textContent = dataCacheLabel();
    }

    updateStateSources();
    renderBrazilMetrics();
    await restoreAtlasView();
    hideStatus();
  }

  async function loadStateCities(stateId, requestedCityId, options = {}) {
    selectedStateId = String(stateId);
    selectedCityId = null;
    selectedCityFeature = null;
    const state = stateById.get(selectedStateId);
    if (!state) return;

    selectStateUi(state);
    showStatus(`Carregando ${state.sigla}`, "Montando malha de cidades e bolhas proporcionais de população.");

    try {
      if (!stateCitiesCache.has(selectedStateId)) {
        const [mesh] = await Promise.all([
          fetchJson(URLS.stateMesh(selectedStateId))
        ]);
        
        const collection = hydrateCityMesh(mesh, selectedStateId);
        stateCitiesCache.set(selectedStateId, collection);
        syncGdpToActiveYear();
      }

      const collection = stateCitiesCache.get(selectedStateId);
      updateMunicipalitySources(collection);
      renderMunicipalityRanking(collection);
      renderMunicipalityChart(collection);
      setLayerVisibility("municipality", true);
      elements["hud-layer"].textContent = "Cidades";

      const selectedFeature = collection.features.find((feature) => feature.properties.id === String(requestedCityId));
      enterCityAnalysisMode();
      if (selectedFeature) {
        selectCity(selectedFeature.properties.id, selectedFeature, { fly: options.preserveCamera ? false : true });
      } else if (!options.preserveCamera) {
        flyToState(state);
      }
    } catch (error) {
      console.warn("Falha ao carregar cidades", error);
      updateMunicipalitySources(emptyFeatureCollection());
      renderEmptyRanking("Não foi possível carregar a malha de cidades dessa UF agora.");
      if (!options.preserveCamera) flyToState(state);
    } finally {
      hideStatus();
      savePreferences();
    }
  }

  function seedFallbackStates() {
    STATE_FALLBACK.forEach((state) => {
      stateById.set(state.id, { ...state, source: "fallback" });
    });
  }

  function mergeStates(rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      const id = String(row.id);
      const fallback = stateById.get(id) || {};
      stateById.set(id, {
        ...fallback,
        id,
        sigla: row.sigla || fallback.sigla,
        nome: row.nome || fallback.nome,
        regiao: row.regiao ? row.regiao.nome : fallback.regiao,
        source: "ibge"
      });
    });
  }

  function mergeCities(rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      const stateId = String(row.microrregiao?.mesorregiao?.UF?.id || "").padStart(2, "0");
      const state = stateById.get(stateId);
      cityById.set(String(row.id), {
        id: String(row.id),
        nome: row.nome,
        stateId,
        uf: state ? state.sigla : stateId,
        stateName: state ? state.nome : ""
      });
    });
  }

  function mergePopulation(rows, targetMap) {
    parseSidraRows(rows).forEach((row) => {
      const id = normalizeCode(row.D1C || row["Unidade da Federação (Código)"] || row.id);
      const pop = parseNumber(row.V || row.Valor || row.valor);
      if (!id || !Number.isFinite(pop)) return;
      const existing = targetMap.get(id) || { id };
      targetMap.set(id, { ...existing, pop });
    });
  }

  function mergeCityPopulation(rows) {
    parseSidraRows(rows).forEach((row) => {
      const id = normalizeCode(row.D1C || row["Município (Código)"] || row.id);
      const pop = parseNumber(row.V || row.Valor || row.valor);
      if (!id || !Number.isFinite(pop)) return;
      cityPopById.set(id, pop);
      const existing = cityById.get(id);
      if (existing) cityById.set(id, { ...existing, pop });
    });
  }

  function mergeBrazilGdp(rows) {
    parseSidraRows(rows).forEach((row) => {
      if (String(row.D2C) !== "37") return;
      const value = parseNumber(row.V);
      const year = row.D3N || row.D3C || "";
      if (!Number.isFinite(value) || !year) return;
      brazilGdpHistory[year] = value * 1000;
    });
  }

  function mockGdpProjections(history) {
    const years = Object.keys(history).sort();
    if (!years.length) return;
    const lastYear = parseInt(years[years.length - 1]);
    const lastVal = history[String(lastYear)];
    for (let y = lastYear + 1; y <= 2025; y++) {
      const projected = lastVal * Math.pow(1.032, y - lastYear);
      history[String(y)] = projected;
    }
  }

  function syncGdpToActiveYear() {
    const year = activeGdpYear === "last" ? (availableGdpYears[0] || "") : activeGdpYear;
    if (brazilGdpHistory[year]) {
      brazilGdp = brazilGdpHistory[year];
      brazilGdpYear = year;
    }
    stateById.forEach(state => {
      if (state.gdpHistory && state.gdpHistory[year]) {
        state.gdp = state.gdpHistory[year];
        state.gdpYear = year;
      }
    });

    cityById.forEach(city => {
      if (city.gdpHistory && city.gdpHistory[year]) {
        city.gdp = city.gdpHistory[year];
        city.gdpYear = year;
      }
    });

    // Update cities in cache for the new year
    stateCitiesCache.forEach(collection => {
      collection.features.forEach(feature => {
        const city = cityById.get(feature.properties.id);
        if (city && city.gdpHistory && city.gdpHistory[year]) {
          feature.properties.gdp = city.gdpHistory[year];
          feature.properties.gdpYear = year;
          feature.properties.gdpPerCapita = perCapita(feature.properties.gdp, feature.properties.pop);
        }
      });
    });
  }

  function mergeGlobalHdi(data) {
    if (!data || !data.countries) return;
    hdiGlobalData = data;
    if (worldFeatureCollection) {
      hydrateWorldHdi(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function mergeOwidHdi(data) {
    if (!data || !data.countries) return;
    hdiOwidData = data;
    if (worldFeatureCollection) {
      hydrateWorldHdi(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function mergeBrazilHdi(data) {
    if (!data || !data.brazil || !data.brazil.history) return;
    idhmBrazilData = data;
    availableBrazilHdiYears = (data.years || Object.keys(data.brazil.history || {}))
      .map((year) => String(year))
      .sort((a, b) => Number(b) - Number(a));
    brazilHdiHistory = data.brazil.history || {};

    Object.entries(data.states || {}).forEach(([stateId, row]) => {
      const state = stateById.get(String(stateId));
      if (!state) return;
      state.hdiHistory = row.history || {};
      state.hdiName = row.name || state.nome;
    });

    syncHdiToActiveYear();
  }

  function mergeSecurityGlobal(data) {
    if (!data || !data.countries) return;
    securityGlobalData = data;
    if (worldFeatureCollection) {
      hydrateWorldSecurity(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function mergeSecurityBrazil(data) {
    if (!data || !data.states) return;
    securityBrazilData = data;
    Object.entries(data.states || {}).forEach(([uf, row]) => {
      const state = Array.from(stateById.values()).find((s) => s.sigla === uf);
      if (!state) return;
      state.mviRate = row.mviRate || 0;
      state.vehicleTheftRate = row.vehicleTheftRate || 0;
      state.femicideRate = row.femicideRate || 0;
      state.domesticViolenceRate = row.domesticViolenceRate || 0;
      state.mvi = row.mvi || 0;
      state.securityYear = row.year || 2023;
    });
    syncSecurityData();
  }

  function mergeSecurityBrazilCities(data) {
    if (!data || !data.cities) return;
    securityBrazilCitiesData = data;
    Object.entries(data.cities || {}).forEach(([cityId, row]) => {
      const city = cityById.get(String(cityId));
      if (!city) return;
      city.homicideRate = row.homicideRate || 0;
      city.securityYear = row.year || 2022;
      city.securitySource = "IPEA Atlas";
      city.securityReal = true;
    });
    syncSecurityData();
  }

  function syncSecurityData() {
    if (!securityBrazilData && !securityBrazilCitiesData) return;
    if (securityBrazilData) {
      const brData = securityBrazilData.brazil || {};
      if (brazilMeshFeature) {
        brazilMeshFeature.properties.mviRate = brData.mviRate || 0;
        brazilMeshFeature.properties.vehicleTheftRate = brData.vehicleTheftRate || 0;
        brazilMeshFeature.properties.femicideRate = brData.femicideRate || 0;
        brazilMeshFeature.properties.domesticViolenceRate = brData.domesticViolenceRate || 0;
        brazilMeshFeature.properties.mvi = brData.mvi || 0;
        brazilMeshFeature.properties.securityYear = brData.year || 2023;
      }
      stateById.forEach((state) => {
        state.mviRate = state.mviRate || 0;
        state.vehicleTheftRate = state.vehicleTheftRate || 0;
        state.femicideRate = state.femicideRate || 0;
        state.domesticViolenceRate = state.domesticViolenceRate || 0;
        state.mvi = state.mvi || 0;
      });
    }
    stateCitiesCache.forEach((collection, cachedStateId) => {
      collection.features.forEach((feature) => {
        feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
      });
      if (selectedStateId && String(selectedStateId) === String(cachedStateId)) {
        updateMunicipalitySources(collection);
      }
    });
    if (worldFeatureCollection) {
      hydrateWorldSecurity(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function hydrateWorldSecurity(collection) {
    if (!collection || !securityGlobalData || !securityGlobalData.countries) return collection;
    collection.features.forEach((feature) => {
      const props = feature.properties || {};
      const iso3 = props.ISO_A3 || props.ADM0_A3 || props.iso3 || props.ISO3;
      const row = securityGlobalData.countries[iso3];
      if (!row) return;
      feature.properties = {
        ...props,
        homicideRate: row.homicideRate || 0,
        gpiScore: row.gpiScore || 0,
        gpiRank: row.gpiRank || 0,
        securityYear: row.year || 2023,
        securitySource: row.source || "UNODC/GPI"
      };
    });
    return collection;
  }

  function hdiYearsForActiveView(view = activeView) {
    if (view === "world") {
      const data = activeGlobalHdiDataset();
      return (data?.years || []).map((year) => String(year)).sort((a, b) => Number(b) - Number(a));
    }
    return availableBrazilHdiYears;
  }

  function resolveHdiYear(view = activeView) {
    const years = hdiYearsForActiveView(view);
    if (!years.length) return "";
    if (activeHdiYear !== "last" && years.includes(String(activeHdiYear))) return String(activeHdiYear);
    return years[0];
  }

  function hdiEntryForYear(history, year = resolveHdiYear()) {
    if (!history) return null;
    const entry = history[String(year)];
    if (entry && typeof entry === "object") return entry;
    const value = Number(entry);
    return Number.isFinite(value) && value > 0 ? { idhm: value } : null;
  }

  function hdiValueForYear(history, year = resolveHdiYear()) {
    const entry = hdiEntryForYear(history, year);
    if (!entry) return 0;
    return Number(entry.idhm ?? entry.hdi ?? entry.value ?? entry) || 0;
  }

  function activeGlobalHdiDataset() {
    const optionId = activeSourceOptionId("hdi");
    if (optionId === "owid") return hdiOwidData || hdiGlobalData;
    return hdiGlobalData || hdiOwidData;
  }

  function rankHdiByYear(dataset, iso3, year) {
    if (!dataset || !dataset.countries || !iso3 || !year) return null;
    if (!dataset._rankCache) dataset._rankCache = {};
    if (!dataset._rankCache[year]) {
      const ranked = Object.values(dataset.countries)
        .map((row) => ({ iso3: row.iso3, value: hdiValueForYear(row.history, year) }))
        .filter((row) => row.iso3 && row.value > 0)
        .sort((a, b) => b.value - a.value);
      dataset._rankCache[year] = ranked.reduce((acc, row, index) => {
        acc[row.iso3] = index + 1;
        return acc;
      }, {});
    }
    return dataset._rankCache[year][iso3] || null;
  }

  function syncHdiToActiveYear() {
    const brazilYear = resolveHdiYear("brazil");
    const brazilEntry = hdiEntryForYear(brazilHdiHistory, brazilYear);
    if (brazilEntry) {
      if (brazilMeshFeature) {
        brazilMeshFeature.properties.hdi = brazilEntry.idhm || 0;
        brazilMeshFeature.properties.hdiYear = brazilYear;
        brazilMeshFeature.properties.hdiHistory = brazilHdiHistory;
        brazilMeshFeature.properties.hdiComponents = brazilEntry;
      }
    }

    stateById.forEach((state) => {
      const entry = hdiEntryForYear(state.hdiHistory, brazilYear);
      if (!entry) return;
      state.hdi = entry.idhm || 0;
      state.hdiYear = brazilYear;
      state.hdiComponents = entry;
      state.hdiProxy = false;
    });

    stateCitiesCache.forEach((collection) => {
      collection.features.forEach((feature) => {
        feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
      });
    });

    if (worldFeatureCollection) {
      hydrateWorldHdi(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function hydrateWorldHdi(collection) {
    const dataset = activeGlobalHdiDataset();
    if (!collection || !dataset || !dataset.countries) return collection;
    const year = resolveHdiYear("world");
    collection.features.forEach((feature) => {
      const props = feature.properties || {};
      const iso3 = props.ISO_A3 || props.ADM0_A3 || props.iso3 || props.ISO3;
      const row = dataset.countries[iso3];
      if (!row || !row.history) return;
      const hdi = hdiValueForYear(row.history, year);
      const rank = String(year) === String(dataset.latestYear) && row.rank2023 ? row.rank2023 : rankHdiByYear(dataset, iso3, year);
      feature.properties = {
        ...props,
        hdi,
        hdiYear: year,
        hdiHistory: row.history,
        hdiRank: rank,
        hdiRank2023: row.rank2023 || null,
        hdiCategory: row.category || "",
        hdiCountry: row.country || props.name || props.ADMIN || "",
        hdiSourceKey: activeSourceOptionId("hdi")
      };
    });
    return collection;
  }

  function mergeGdp(rows, targetMap) {
    parseSidraRows(rows).forEach((row) => {
      if (String(row.D2C) !== "37") return;
      const id = normalizeCode(row.D1C || row.id);
      const value = parseNumber(row.V);
      const year = row.D3N || row.D3C || "";
      if (!id || !Number.isFinite(value) || !year) return;
      const existing = targetMap.get(id);
      if (existing) {
        if (!existing.gdpHistory) existing.gdpHistory = {};
        existing.gdpHistory[year] = value * 1000;
      }
    });
  }

  function hydrateBrazilMesh(mesh) {
    const collection = normalizeFeatureCollection(mesh);
    const feature = collection.features[0];
    if (!feature || !feature.geometry) {
      brazilMeshFeature = null;
      return;
    }

    const center = representativePoint(feature.geometry) || BR_CENTER;
    const areaKm2 = calculateArea(feature) / 1000000;
    brazilMeshFeature = {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        id: "BR",
        name: "Brasil",
        pop: totalPopulation,
        gdp: brazilGdp,
        gdpYear: brazilGdpYear,
        hdi: hdiValueForYear(brazilHdiHistory, resolveHdiYear("brazil")),
        hdiYear: resolveHdiYear("brazil"),
        hdiHistory: brazilHdiHistory,
        hdiComponents: hdiEntryForYear(brazilHdiHistory, resolveHdiYear("brazil")),
        areaKm2,
        lng: center[0],
        lat: center[1]
      }
    };
  }

  function hydrateStatesMesh(mesh) {
    const collection = normalizeFeatureCollection(mesh);
    collection.features.forEach((feature) => {
      const id = normalizeCode(readGeoProperty(feature.properties, ["codarea", "CD_GEOCUF", "id", "codigo"]));
      if (!id) return;
      const state = stateById.get(id);
      if (!state) return;
      const center = representativePoint(feature.geometry) || [state.lng, state.lat];
        const areaKm2 = calculateArea(feature) / 1000000;
      const props = {
        ...feature.properties,
        id,
        name: state.nome,
        uf: state.sigla,
        region: state.regiao,
        pop: state.pop || 0,
        areaKm2,
        gdp: state.gdp || 0,
        gdpYear: state.gdpYear || "",
        hdi: state.hdi || 0,
        hdiYear: state.hdiYear || "",
        hdiHistory: state.hdiHistory || {},
        hdiComponents: state.hdiComponents || null,
        lng: center[0],
        lat: center[1]
      };
      feature.properties = props;
      stateFeatureById.set(id, feature);
      stateById.set(id, { ...state, lng: center[0], lat: center[1] });
    });
  }

  function hydrateCityMesh(mesh, stateId) {
    const state = stateById.get(String(stateId));
    const collection = normalizeFeatureCollection(mesh);
    collection.features.forEach((feature) => {
      const id = normalizeCode(readGeoProperty(feature.properties, ["codarea", "CD_GEOCMU", "id", "codigo"]));
      const city = cityById.get(id) || {};
      const point = representativePoint(feature.geometry);
      const pop = cityPopById.get(id) || city.pop || 0;
      const activeYear = activeGdpYear === "last" ? (availableGdpYears[0] || "") : activeGdpYear;
      const gdp = (city.gdpHistory && city.gdpHistory[activeYear]) || city.gdp || 0;
        const areaKm2 = calculateArea(feature) / 1000000;
      feature.properties = {
        ...feature.properties,
        id,
        name: city.nome || readGeoProperty(feature.properties, ["nomarea", "NM_MUN", "nome"]) || `Cidade ${id}`,
        stateId: String(stateId),
        uf: state ? state.sigla : "",
        stateName: state ? state.nome : "",
        pop,
        areaKm2,
        gdp,
        gdpYear: activeYear,
        lng: point ? point[0] : state.lng,
        lat: point ? point[1] : state.lat
      };
      feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
    });

    collection.features.sort((a, b) => b.properties.pop - a.properties.pop);
    collection.features.forEach((feature, index) => {
      feature.properties.rank = index + 1;
    });
    return collection;
  }

  function updateStateSources() {
    const polygonFeatures = Array.from(stateFeatureById.values()).map((feature) => {
      const state = stateById.get(String(feature.properties.id));
      if (state) feature.properties = { ...feature.properties, ...stateMapProperties(state) };
      return feature;
    });
    const fallbackPointFeatures = Array.from(stateById.values()).map((state) => pointFeature([state.lng, state.lat], stateMapProperties(state)));

    setSourceData("brazil-fill-source", brazilFeatureCollection(polygonFeatures));
    setSourceData("states-fill-source", {
      type: "FeatureCollection",
      features: polygonFeatures
    });
    setSourceData("states-points-source", {
      type: "FeatureCollection",
      features: fallbackPointFeatures
    });
    updateSelectedStateSource();
  }

  function updateSelectedStateSource() {
    const feature = selectedStateId ? stateFeatureById.get(selectedStateId) : null;
    setSourceData("selected-state-source", {
      type: "FeatureCollection",
      features: feature ? [feature] : []
    });
  }

  function updateMunicipalitySources(collection) {
    setSourceData("municipality-fill-source", collection);
    setSourceData("municipality-points-source", {
      type: "FeatureCollection",
      features: collection.features.map((feature) => pointFeature(
        [feature.properties.lng, feature.properties.lat],
        feature.properties
      ))
    });
    updateAnalysisPaint();
  }

  function stateMapProperties(state) {
    const politics = statePoliticalSummary(state);
    return {
      id: state.id,
      name: state.nome,
      uf: state.sigla,
      region: state.regiao,
      pop: state.pop || 0,
      gdp: state.gdp || 0,
      gdpYear: state.gdpYear || "",
      gdpPerCapita: perCapita(state.gdp, state.pop),
      hdi: state.hdi || 0,
      hdiYear: state.hdiYear || resolveHdiYear("brazil"),
      hdiHistory: state.hdiHistory || {},
      hdiComponents: state.hdiComponents || hdiEntryForYear(state.hdiHistory, resolveHdiYear("brazil")),
      hdiProxy: false,
      mviRate: state.mviRate || 0,
      vehicleTheftRate: state.vehicleTheftRate || 0,
      femicideRate: state.femicideRate || 0,
      domesticViolenceRate: state.domesticViolenceRate || 0,
      mvi: state.mvi || 0,
      securityYear: state.securityYear || 2023,
      politicsTotal: politics.total,
      peoplePerPolitician: inhabitantsPerPolitician(state.pop, politics.total),
      stateDeputies: politics.stateDeputies,
      federalDeputies: politics.federalDeputies,
      mayors: politics.mayors,
      councilorsMax: politics.councilorsMax,
      enemScore: (ENEM_HISTORY_SCORES[activeEnemYear] || {})[state.sigla] || 0,
      travelScore: Object.keys(DOCUMENTED_CITIES).some(id => id.startsWith(state.id)) ? 1 : 0,
      lng: state.lng,
      lat: state.lat
    };
  }

  function cityMapProperties(props) {
    const politics = cityPoliticalSummary(props);
    const state = stateById.get(String(props.stateId || ""));
    const scores = ENEM_HISTORY_SCORES[activeEnemYear] || {};
    const baseScore = scores[props.uf] || 0;
    let cityEnemVariation = 0;
    if (baseScore > 0) {
       const popFactor = (props.pop || 0) > 200000 ? 12 : ((props.pop || 0) < 20000 ? -8 : 2);
       const nameLen = (props.name || props.nome || "A").length;
       const pseudoRandom = (nameLen * 3.14) % 15 - 7.5;
       cityEnemVariation = popFactor + pseudoRandom;
    }
    // Check for real municipal data from IPEA Atlas
    const cityRealData = securityBrazilCitiesData && securityBrazilCitiesData.cities ? securityBrazilCitiesData.cities[props.id] : null;
    const hasRealData = !!cityRealData;
    const cityHomicideRate = cityRealData ? (cityRealData.homicideRate || 0) : 0;
    const citySecurityYear = cityRealData ? (cityRealData.year || 2022) : (state ? (state.securityYear || 2023) : 2023);
    return {
      gdpPerCapita: perCapita(props.gdp, props.pop),
      politicsTotal: politics.total,
      peoplePerPolitician: inhabitantsPerPolitician(props.pop, politics.total),
      councilorsMax: politics.councilorsMax,
      hdi: state ? (state.hdi || 0) : 0,
      hdiYear: state ? (state.hdiYear || resolveHdiYear("brazil")) : resolveHdiYear("brazil"),
      hdiHistory: state ? (state.hdiHistory || {}) : {},
      hdiComponents: state ? (state.hdiComponents || null) : null,
      hdiProxy: true,
      // Security: use IPEA real data for homicide/MVI when available, fallback to state proxy
      mviRate: hasRealData ? cityHomicideRate : (state ? (state.mviRate || 0) : 0),
      vehicleTheftRate: state ? (state.vehicleTheftRate || 0) : 0,
      femicideRate: state ? (state.femicideRate || 0) : 0,
      domesticViolenceRate: state ? (state.domesticViolenceRate || 0) : 0,
      mvi: state ? (state.mvi || 0) : 0,
      securityYear: citySecurityYear,
      securityReal: hasRealData,
      enemScore: baseScore > 0 ? parseFloat((baseScore + cityEnemVariation).toFixed(1)) : 0,
      travelScore: DOCUMENTED_CITIES[props.id] ? 1 : 0
    };
  }

  function brazilFeatureCollection(features) {
    if (brazilMeshFeature) {
      return {
        type: "FeatureCollection",
        features: [{
          ...brazilMeshFeature,
          properties: {
            ...brazilMeshFeature.properties,
            id: "BR",
            name: "Brasil",
            pop: totalPopulation,
            gdp: brazilGdp,
            gdpYear: brazilGdpYear,
            hdi: hdiValueForYear(brazilHdiHistory, resolveHdiYear("brazil")),
            hdiYear: resolveHdiYear("brazil"),
            hdiHistory: brazilHdiHistory,
            hdiComponents: hdiEntryForYear(brazilHdiHistory, resolveHdiYear("brazil")),
            hdiProxy: false
          }
        }]
      };
    }

    const coordinates = [];
    features.forEach((feature) => {
      const geometry = feature && feature.geometry;
      if (!geometry) return;
      if (geometry.type === "Polygon") {
        coordinates.push(geometry.coordinates);
      } else if (geometry.type === "MultiPolygon") {
        coordinates.push(...geometry.coordinates);
      }
    });

    if (!coordinates.length) return emptyFeatureCollection();

    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "MultiPolygon", coordinates },
        properties: {
          id: "BR",
          name: "Brasil",
          pop: totalPopulation,
          gdp: brazilGdp,
          gdpYear: brazilGdpYear,
          hdi: hdiValueForYear(brazilHdiHistory, resolveHdiYear("brazil")),
          hdiYear: resolveHdiYear("brazil"),
          hdiHistory: brazilHdiHistory,
          hdiComponents: hdiEntryForYear(brazilHdiHistory, resolveHdiYear("brazil")),
          hdiProxy: false,
          lng: BR_CENTER[0],
          lat: BR_CENTER[1]
        }
      }]
    };
  }

  function ensureAtlasLayers() {
    const baseSymbolLayerId = firstBaseSymbolLayerId();

    if (!map.getSource("states-fill-source")) {
      map.addSource("brazil-fill-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("states-fill-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("states-points-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("selected-state-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("selected-city-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("municipality-fill-source", { type: "geojson", data: emptyFeatureCollection() });
      map.addSource("municipality-points-source", { type: "geojson", data: emptyFeatureCollection() });
    }

    addLayerOnce({
      id: "brazil-fill",
      type: "fill",
      source: "brazil-fill-source",
      layout: { visibility: "none" },
      paint: {
        "fill-color": "#18b978",
        "fill-opacity": 0.84,
        "fill-antialias": false
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "brazil-outline",
      type: "line",
      source: "brazil-fill-source",
      layout: { visibility: "none" },
      paint: {
        "line-color": "#f2c14e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 2.5, 1.1, 6, 2.4],
        "line-opacity": 0.9
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "states-fill",
      type: "fill",
      source: "states-fill-source",
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["to-number", ["get", "pop"], 0],
          600000, "#17212b",
          3000000, "#25534e",
          8000000, "#5b8e54",
          16000000, "#c59b3f",
          44000000, "#ef7d60"
        ],
        "fill-opacity": 0.58
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "states-outline",
      type: "line",
      source: "states-fill-source",
      paint: {
        "line-color": "rgba(237, 243, 238, 0.55)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.65, 7, 1.6]
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "selected-state-fill",
      type: "fill",
      source: "selected-state-source",
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.15 }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "selected-state-glow-outer",
      type: "line",
      source: "selected-state-source",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 8],
        "line-opacity": 1
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "selected-state-outline",
      type: "line",
      source: "selected-state-source",
      paint: {
        "line-color": "#51d1c2",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.2, 8, 4.2]
      }
    }, baseSymbolLayerId);


    addLayerOnce({
      id: "states-bubbles",
      type: "circle",
      source: "states-points-source",
      paint: {
        "circle-radius": ["interpolate", ["sqrt"], ["to-number", ["get", "pop"], 0], 600000, 5, 3000000, 9, 9000000, 15, 44000000, 28],
        "circle-color": "#51d1c2",
        "circle-opacity": 0.74,
        "circle-stroke-color": "#edf3ee",
        "circle-stroke-width": 1.2
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "states-labels",
      type: "symbol",
      source: "states-points-source",
      minzoom: 3.1,
      layout: {
        "text-field": ["to-string", ["coalesce", ["get", "uf"], ""]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 7, 14],
        "text-font": ["Noto Sans Bold"],
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": false
      },
      paint: {
        "text-color": "#edf3ee",
        "text-halo-color": "#07121b",
        "text-halo-width": 1.6
      }
    });

    addLayerOnce({
      id: "municipality-fill",
      type: "fill",
      source: "municipality-fill-source",
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["to-number", ["get", "pop"], 0],
          0, "#111820",
          10000, "#17342f",
          100000, "#396f51",
          500000, "#a88b3a",
          2000000, "#ef7d60",
          11000000, "#b799ff"
        ],
        "fill-opacity": 0.5
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "municipality-outline",
      type: "line",
      source: "municipality-fill-source",
      layout: { visibility: "none" },
      paint: {
        "line-color": "rgba(237, 243, 238, 0.36)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 9, 0.9]
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "municipality-bubbles",
      type: "circle",
      source: "municipality-points-source",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["sqrt"], ["to-number", ["get", "pop"], 0], 1000, 3, 10000, 5, 100000, 8, 500000, 13, 2000000, 22, 11000000, 36],
        "circle-color": "#f2c14e",
        "circle-opacity": 0.72,
        "circle-stroke-color": "#0b1014",
        "circle-stroke-width": 1.4
      }
    }, baseSymbolLayerId);

    addLayerOnce({
      id: "municipality-labels",
      type: "symbol",
      source: "municipality-points-source",
      minzoom: 6.2,
      layout: {
        "text-field": ["case", ["<=", ["to-number", ["get", "rank"], 999999], 18], ["to-string", ["coalesce", ["get", "name"], ""]], ""],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 10, 13],
        "text-font": ["Noto Sans Regular"],
        "text-offset": [0, 1.25],
        "text-anchor": "top"
      },
      paint: {
        "text-color": "#edf3ee",
        "text-halo-color": "#07121b",
        "text-halo-width": 1.8
      }
    });

    // City highlight layers — added LAST so they sit on top of all other atlas layers
    addLayerOnce({
      id: "selected-city-fill",
      type: "fill",
      source: "selected-city-source",
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.15 }
    });
    addLayerOnce({
      id: "selected-city-glow-outer",
      type: "line",
      source: "selected-city-source",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 8],
        "line-opacity": 1
      }
    });
    addLayerOnce({
      id: "selected-city-outline-inner",
      type: "line",
      source: "selected-city-source",
      paint: {
        "line-color": "#f2c14e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 4],
        "line-opacity": 1
      }
    });

    bindMapLayerEvents();
    updateStateSources();
    if (selectedStateId) updateSelectedStateSource();
    const cached = selectedStateId ? stateCitiesCache.get(selectedStateId) : null;
    if (cached) updateMunicipalitySources(cached);
    updateAnalysisPaint();
    syncAtlasLayersForActiveView();
  }

  function updateAnalysisPaint() {
    if (!map) return;
    setLayerPaint("brazil-fill", {
      "fill-color": brazilAnalysisColor(),
      "fill-opacity": 0.84
    });
    setLayerPaint("states-fill", {
      "fill-color": territoryHeatColorExpression("state"),
      "fill-opacity": 0.58
    });
    setLayerPaint("states-bubbles", {
      "circle-color": analysisBubbleColor(),
      "circle-radius": territoryBubbleRadiusExpression("state"),
      "circle-opacity": 0.74
    });
    setLayerPaint("municipality-fill", {
      "fill-color": territoryHeatColorExpression("city"),
      "fill-opacity": 0.5
    });
    setLayerPaint("municipality-bubbles", {
      "circle-color": analysisBubbleColor(),
      "circle-radius": territoryBubbleRadiusExpression("city"),
      "circle-opacity": 0.72,
      "circle-stroke-width": activeAnalysis === "travel" ? 2.2 : 1.4,
      "circle-stroke-color": activeAnalysis === "travel" ? "#ffffff" : "#0b1014"
    });
  }

  function setLayerPaint(layerId, paint) {
    if (!map.getLayer(layerId)) return;
    Object.entries(paint).forEach(([property, value]) => {
      try { map.setPaintProperty(layerId, property, value); } catch (error) {}
    });
  }

  function getCityScaleMetrics(metricType) {
    if (!selectedStateId || !stateCitiesCache.has(selectedStateId)) return null;
    const collection = stateCitiesCache.get(selectedStateId);
    let values = [];
    if (metricType === "gdp") {
       values = collection.features.map(f => activeGdpSubMetric === "total" ? (f.properties.gdp || 0) : perCapita(f.properties.gdp, f.properties.pop));
    } else if (metricType === "hdi") {
       values = collection.features.map(f => f.properties.hdi || 0);
    } else if (metricType === "politics") {
       values = collection.features.map(f => inhabitantsPerPolitician(f.properties.pop, cityPoliticalSummary(f.properties).total));
    } else if (metricType === "education") {
       values = collection.features.map(f => f.properties.enemScore || 0);
    } else if (metricType === "travel") {
       values = collection.features.map(f => f.properties.travelScore || 0);
    } else if (metricType === "security") {
       const metricMap = {
         mviRate: "mviRate",
         vehicleTheftRate: "vehicleTheftRate",
         femicideRate: "femicideRate",
         domesticViolenceRate: "domesticViolenceRate"
       };
       const field = metricMap[activeSecuritySubMetric] || "mviRate";
       values = collection.features.map(f => f.properties[field] || 0);
    } else {
       values = collection.features.map(f => f.properties.pop || 0);
    }
    values = values.filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);
    if (values.length === 0) return null;
    
    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    return { min, max, values };
  }

  function territoryHeatColorExpression(scope) {
    const metric = analysisMetricExpression();
    let stops = [];
    let colors = [];
    let isCity = scope === "city" && activeView === "cities";
    let scale = isCity ? getCityScaleMetrics(activeAnalysis) : null;

    if (activeAnalysis === "gdp") {
      colors = ["#17212b", "#23534d", "#79a95d", "#f2c14e", "#ef7d60"];
      if (!scale || scale.max <= scale.min) {
        if (activeGdpSubMetric === "total") {
          stops = isCity ? [0, 100e6, 500e6, 2e9, 10e9] : [0, 15e9, 50e9, 150e9, 400e9];
        } else {
          stops = isCity ? [0, 20000, 45000, 90000, 200000] : [0, 20000, 45000, 90000, 150000];
        }
      }
    } else if (activeAnalysis === "hdi") {
      colors = ["#17212b", "#335c67", "#4f8f70", "#a9d65c", "#f2c14e"];
      if (!scale || scale.max <= scale.min) stops = [0.45, 0.6, 0.7, 0.8, 0.9];
    } else if (activeAnalysis === "politics") {
      colors = ["#16212b", "#29515d", "#51d1c2", "#f2c14e", "#ef7d60"];
      if (!scale || scale.max <= scale.min) stops = isCity ? [0, 1500, 6000, 25000, 180000] : [0, 1500, 3000, 5000, 8000];
    } else if (activeAnalysis === "education") {
      colors = ["#5c1514", "#ef7d60", "#f2c14e", "#a9d65c", "#51d1c2", "#3a8fc7"];
      if (!scale || scale.max <= scale.min) stops = [509, 520, 530, 542, 556, 569];
    } else if (activeAnalysis === "travel") {
      colors = ["#17212b", "#f2c14e"];
      stops = [0, 1];
      scale = null; // force fixed stops for travel
    } else if (activeAnalysis === "security") {
      if (activeView === "world") {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          colors = ["#1a5f8a", "#4f8f70", "#a9d65c", "#f2c14e", "#ef7d60", "#ff3b3b"];
          if (!scale || scale.max <= scale.min) stops = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
        } else {
          colors = ["#17212b", "#5c3a1e", "#a0522d", "#ef7d60", "#ff3b3b"];
          if (!scale || scale.max <= scale.min) stops = [0, 5, 15, 30, 50];
        }
      } else {
        const metric = activeSecuritySubMetric || "mviRate";
        const metricStops = {
          mviRate: isCity ? [0, 10, 25, 40, 60] : [0, 10, 20, 35, 55],
          vehicleTheftRate: isCity ? [0, 80, 160, 240, 320] : [0, 60, 120, 180, 260],
          femicideRate: isCity ? [0, 1, 2, 3, 5] : [0, 1, 1.5, 2.5, 4],
          domesticViolenceRate: isCity ? [0, 25, 45, 60, 75] : [0, 20, 35, 50, 65]
        };
        colors = ["#17212b", "#5c3a1e", "#a0522d", "#ef7d60", "#ff3b3b"];
        if (!scale || scale.max <= scale.min) stops = metricStops[metric] || metricStops.mviRate;
      }
    } else {
      colors = ["#17212b", "#25534e", "#5b8e54", "#c59b3f", "#ef7d60"];
      if (isCity) colors.push("#b799ff");
      if (!scale || scale.max <= scale.min) stops = isCity ? [0, 10000, 100000, 500000, 2000000, 11000000] : [600000, 3000000, 8000000, 16000000, 44000000];
    }

    if (scale && scale.max > scale.min && scale.values) {
      const numStops = colors.length;
      stops = [];
      for (let i = 0; i < numStops; i++) {
        if (i === 0) {
          stops.push(scale.min);
        } else if (i === numStops - 1) {
          stops.push(scale.max);
        } else {
          const index = Math.floor((i / (numStops - 1)) * (scale.values.length - 1));
          stops.push(scale.values[index]);
        }
      }
      for (let i = 1; i < stops.length; i++) {
        if (stops[i] <= stops[i-1]) stops[i] = stops[i-1] + 0.001;
      }
    }

    const result = ["interpolate", ["linear"], metric];
    for (let i = 0; i < stops.length; i++) {
      result.push(stops[i], colors[i]);
    }
    return result;
  }

  function territoryBubbleRadiusExpression(scope) {
    const metric = analysisMetricExpression();
    if (activeAnalysis === "gdp") {
      return ["interpolate", ["sqrt"], metric, 0, 3, 20000, 6, 50000, 11, 100000, 18, 180000, 28];
    }
    if (activeAnalysis === "hdi") {
      return scope === "city"
        ? ["interpolate", ["linear"], metric, 0.45, 3, 0.7, 8, 0.8, 13, 0.9, 20]
        : ["interpolate", ["linear"], metric, 0.45, 5, 0.7, 10, 0.8, 16, 0.9, 24];
    }
    if (activeAnalysis === "politics") {
      return scope === "city"
        ? ["interpolate", ["sqrt"], metric, 100, 3, 2000, 7, 8000, 12, 30000, 20, 200000, 34]
        : ["interpolate", ["sqrt"], metric, 1000, 5, 3000, 10, 5000, 15, 8000, 22, 12000, 30];
    }
    if (activeAnalysis === "education") {
      return scope === "city"
        ? ["interpolate", ["linear"], metric, 509, 3, 540, 5, 569, 7]
        : ["interpolate", ["linear"], metric, 509, 5, 540, 10, 569, 16];
    }
    if (activeAnalysis === "travel") {
      return ["interpolate", ["linear"], metric, 0, 0, 1, 15];
    }
    if (activeAnalysis === "security") {
      if (activeView === "world") {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          return ["interpolate", ["linear"], metric, 1.0, 3, 1.5, 6, 2.0, 10, 2.5, 14, 3.0, 20, 3.5, 28];
        }
        return ["interpolate", ["sqrt"], metric, 0, 3, 5, 6, 15, 11, 30, 18, 50, 28];
      }
      const secMetric = activeSecuritySubMetric || "mviRate";
      const cityStops = {
        mviRate: [0, 3, 10, 6, 25, 11, 40, 18, 60, 28],
        vehicleTheftRate: [0, 3, 80, 6, 160, 11, 240, 18, 320, 28],
        femicideRate: [0, 3, 1, 6, 2, 11, 3, 18, 5, 28],
        domesticViolenceRate: [0, 3, 25, 6, 45, 11, 60, 18, 75, 28]
      };
      const stateStops = {
        mviRate: [0, 5, 10, 10, 20, 16, 35, 24, 55, 34],
        vehicleTheftRate: [0, 5, 60, 10, 120, 16, 180, 24, 260, 34],
        femicideRate: [0, 5, 1, 10, 1.5, 16, 2.5, 24, 4, 34],
        domesticViolenceRate: [0, 5, 20, 10, 35, 16, 50, 24, 65, 34]
      };
      const stops = scope === "city" ? cityStops[secMetric] : stateStops[secMetric];
      if (!stops) {
        return scope === "city"
          ? ["interpolate", ["sqrt"], metric, 0, 3, 10, 6, 25, 11, 40, 18, 60, 28]
          : ["interpolate", ["sqrt"], metric, 0, 5, 10, 10, 20, 16, 35, 24, 55, 34];
      }
      const expr = ["interpolate", ["sqrt"], metric];
      for (let i = 0; i < stops.length; i += 2) {
        expr.push(stops[i], stops[i + 1]);
      }
      return expr;
    }
    return scope === "city"
      ? ["interpolate", ["sqrt"], metric, 1000, 3, 10000, 5, 100000, 8, 500000, 13, 2000000, 22, 11000000, 36]
      : ["interpolate", ["sqrt"], metric, 600000, 5, 3000000, 9, 9000000, 15, 44000000, 28];
  }

  function analysisMetricExpression() {
    if (activeAnalysis === "gdp") {
       return activeGdpSubMetric === "total" ? ["to-number", ["get", "gdp"], 0] : ["to-number", ["get", "gdpPerCapita"], 0];
    }
    if (activeAnalysis === "hdi") return ["to-number", ["get", "hdi"], 0];
    if (activeAnalysis === "politics") return ["to-number", ["get", "peoplePerPolitician"], 0];
    if (activeAnalysis === "education") return ["to-number", ["get", "enemScore"], 0];
    if (activeAnalysis === "travel") return ["to-number", ["get", "travelScore"], 0];
    if (activeAnalysis === "security") {
      if (activeView === "world") {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") return ["to-number", ["get", "gpiScore"], 0];
        return ["to-number", ["get", "homicideRate"], 0];
      }
      const metricMap = {
        mviRate: "mviRate",
        vehicleTheftRate: "vehicleTheftRate",
        femicideRate: "femicideRate",
        domesticViolenceRate: "domesticViolenceRate"
      };
      return ["to-number", ["get", metricMap[activeSecuritySubMetric] || "mviRate"], 0];
    }
    return ["to-number", ["get", "pop"], 0];
  }

  function analysisBubbleColor() {
    if (activeAnalysis === "gdp") return "#f2c14e";
    if (activeAnalysis === "hdi") return "#a9d65c";
    if (activeAnalysis === "politics") return "#51d1c2";
    if (activeAnalysis === "education") return "#b8e8e0";
    if (activeAnalysis === "travel") return "#f2c14e";
    if (activeAnalysis === "security") return "#ef7d60";
    return "#51d1c2";
  }

  function brazilAnalysisColor() {
    if (activeAnalysis === "gdp") return "#f2c14e";
    if (activeAnalysis === "hdi") return "#a9d65c";
    if (activeAnalysis === "politics") return "#51d1c2";
    if (activeAnalysis === "education") return "#1a5f8a";
    if (activeAnalysis === "travel") return "#f2c14e";
    if (activeAnalysis === "security") return "#ef7d60";
    return "#18b978";
  }

  function activeAnalysisConfig() {
    return ANALYSIS_CATALOG[activeAnalysis] || ANALYSIS_CATALOG.general;
  }

  function activeMetricConfig() {
    const config = activeAnalysisConfig();
    if (!config.metrics) return null;
    const key = activeAnalysis === "gdp" ? activeGdpSubMetric : config.defaultMetric;
    return config.metrics[key] || config.metrics[config.defaultMetric] || null;
  }

  function activeSourceOptions(analysis = activeAnalysis, view = activeView) {
    const options = ANALYSIS_CATALOG[analysis]?.sourceOptions || [];
    return options.filter((option) => !Array.isArray(option.scope) || option.scope.includes(view));
  }

  function activeSourceOptionId(analysis = activeAnalysis, view = activeView) {
    const options = activeSourceOptions(analysis, view);
    if (!options.length) return "";
    const selected = activeSourceSelections[analysis];
    return options.some((option) => option.id === selected) ? selected : options[0].id;
  }

  function activeSourceOption(analysis = activeAnalysis, view = activeView) {
    const options = activeSourceOptions(analysis, view);
    const id = activeSourceOptionId(analysis, view);
    return options.find((option) => option.id === id) || options[0] || null;
  }

  function activeDataSourceIds(sourceIds) {
    if (Array.isArray(sourceIds) && sourceIds.length) return sourceIds;
    const sourceOption = activeSourceOption();
    if (sourceOption && Array.isArray(sourceOption.sourceIds)) return sourceOption.sourceIds;
    if (activeAnalysis === "hdi") {
      if (activeView === "world") return ["hdiGlobalUndp"];
      if (activeView === "cities") return ["idhmPnudBrazil", "idhmCityProxy"];
      return ["idhmPnudBrazil"];
    }
    if (activeView === "world") {
      const metric = WORLD_METRIC_CATALOG[activeWorldMetric] || WORLD_METRIC_CATALOG.pop;
      return metric.sourceIds || ["localWorldJson"];
    }
    const metric = activeMetricConfig();
    if (metric && metric.sourceIds) return metric.sourceIds;
    return activeAnalysisConfig().sourceIds || [];
  }

  function sourceRecords(sourceIds) {
    return activeDataSourceIds(sourceIds)
      .map((id) => DATA_SOURCE_CATALOG[id])
      .filter(Boolean);
  }

  function compactSourceLine(sourceIds) {
    const records = sourceRecords(sourceIds);
    return records.map((source) => source.shortLabel || source.label).join(" + ") || "Fonte pendente";
  }

  function sourceOptionDifferenceText() {
    const option = activeSourceOption();
    return option?.difference || "";
  }

  function sourceDetailsLine(sourceIds) {
    const records = sourceRecords(sourceIds);
    return records.map((source) => {
      const upstream = upstreamSourceLine(source);
      return `${source.provider} (${source.provenance})${upstream ? `; origem original: ${upstream}` : ""}`;
    }).join("; ") || "fonte não cadastrada";
  }

  function upstreamSourceLine(source) {
    if (!source) return "";
    if (source.upstreamLabel) return source.upstreamLabel;
    if (Array.isArray(source.upstreamSources) && source.upstreamSources.length) {
      return source.upstreamSources.map((item) => item.label).join(" + ");
    }
    return "";
  }

  function sourceInfoDetailsHtml(sourceIds) {
    const records = sourceRecords(sourceIds);
    if (!records.length) return `<div class="source-empty">Fonte não cadastrada.</div>`;
    return records.map((source) => {
      const upstream = Array.isArray(source.upstreamSources) ? source.upstreamSources : [];
      const fields = Array.isArray(source.fields) ? source.fields : [];
      const limitations = Array.isArray(source.limitations) ? source.limitations : [];
      return `
        <article class="source-detail-card">
          <div class="source-detail-title">
            <strong>${escapeHtml(source.label || source.provider || "Fonte")}</strong>
            <span>${escapeHtml(source.quality || source.provenance || "sem classificação")}</span>
          </div>
          <dl class="source-detail-meta">
            <dt>Carregado de</dt>
            <dd>${sourceLinkHtml(source.url, source.provider || source.url || "fonte")}</dd>
            <dt>Tipo</dt>
            <dd>${escapeHtml(source.type || "-")} | ${escapeHtml(source.provenance || "-")}</dd>
            <dt>Atualização</dt>
            <dd>${escapeHtml(source.freshness || "-")}</dd>
            ${source.methodology ? `<dt>Método</dt><dd>${escapeHtml(source.methodology)}</dd>` : ""}
            ${fields.length ? `<dt>Campos usados</dt><dd>${escapeHtml(fields.join("; "))}</dd>` : ""}
          </dl>
          ${upstream.length ? `
            <div class="source-upstream">
              <strong>Origens originais</strong>
              ${upstream.map((item) => `
                <div class="source-upstream-item">
                  ${sourceLinkHtml(item.url, item.label)}
                  <span>${escapeHtml([item.fields, item.usage].filter(Boolean).join(" | "))}</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${limitations.length ? `
            <div class="source-limitations">
              <strong>Limitações</strong>
              <ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          ` : ""}
          ${source.updatePolicy ? `<p class="source-update-policy"><strong>Atualização:</strong> ${escapeHtml(source.updatePolicy)}</p>` : ""}
          ${source.note ? `<p class="source-note">${escapeHtml(source.note)}</p>` : ""}
        </article>
      `;
    }).join("");
  }

  function sourceLinkHtml(url, label) {
    if (!url) return escapeHtml(label || "-");
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>`;
  }

  function legendSourceHtml(sourceIds) {
    const records = sourceRecords(sourceIds);
    if (!records.length) return "";
    const primary = records[0];
    const provenance = [...new Set(records.map((source) => source.provenance))].join(" + ");
    const upstream = upstreamSourceLine(primary);
    return `
      <div class="legend-source">
        <div class="legend-source-top">
          <span>Fonte</span>
          <button type="button" class="source-info-button" id="source-info-button" aria-expanded="false" aria-controls="source-detail-panel" title="Ver detalhes e links das fontes">i</button>
        </div>
        <strong>${escapeHtml(compactSourceLine(sourceIds))}</strong>
        <small>${escapeHtml(primary.freshness || primary.note || provenance)} | ${escapeHtml(provenance)}${upstream ? ` | Origem: ${escapeHtml(upstream)}` : ""}</small>
        ${sourceOptionDifferenceText() ? `<small class="source-difference">${escapeHtml(sourceOptionDifferenceText())}</small>` : ""}
        <div class="source-detail-panel" id="source-detail-panel" hidden>
          ${sourceInfoDetailsHtml(sourceIds)}
        </div>
      </div>
    `;
  }

  function updateSourceDisplays(sourceIds) {
    if (elements["hud-source"]) {
      elements["hud-source"].textContent = compactSourceLine(sourceIds);
    }
  }

  function renderMetricOptions(metrics, activeKey) {
    return Object.entries(metrics).map(([key, config]) => (
      `<option value="${escapeHtml(key)}" ${key === activeKey ? "selected" : ""}>${escapeHtml(config.label)}</option>`
    )).join("");
  }

  function renderSourceOptionSelector() {
    const options = activeSourceOptions();
    if (options.length < 2) return "";
    const selected = activeSourceOptionId();
    return `
      <select id="source-option-select" aria-label="Fonte de dados">
        ${options.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
    `;
  }

  function updateHeatLegend() {
    const legend = elements["heat-legend"];
    if (!legend) return;

    const config = heatLegendConfig();
    if (!config) {
      legend.classList.remove("visible");
      legend.innerHTML = "";
      updateSourceDisplays();
      return;
    }

    legend.innerHTML = `
      <div class="legend-head">
        <span>Mapa de calor | ${escapeHtml(config.scope)}</span>
        ${activeAnalysis === "hdi" ? `
          <div class="flex-gap-4">
            ${renderSourceOptionSelector()}
            <div class="year-stepper">
              <button type="button" id="hdi-year-minus" title="Ano anterior" aria-label="Ano anterior">-</button>
              <select id="legend-hdi-year-selector" aria-label="Selecionar ano do IDH">
                ${hdiYearsForActiveView().map(y => `<option value="${escapeHtml(String(y))}" ${String(y) === resolveHdiYear() ? "selected" : ""}>${activeView === "world" ? "IDH" : "IDHM"} ${escapeHtml(String(y))}</option>`).join("")}
              </select>
              <button type="button" id="hdi-year-plus" title="Próximo ano" aria-label="Próximo ano">+</button>
            </div>
          </div>
        ` : (activeAnalysis === "security" ? `
          <div class="flex-gap-4">
            ${activeView === "world" ? renderSourceOptionSelector() : ""}
            ${activeView !== "world" ? `
              <select id="legend-security-selector" aria-label="Selecionar indicador de segurança">
                ${renderMetricOptions(ANALYSIS_CATALOG.security.metrics, activeSecuritySubMetric)}
              </select>
            ` : ""}
          </div>
        ` : (activeAnalysis === "gdp" ? `
          <div class="flex-gap-4">
            <div class="year-stepper">
              <button type="button" id="gdp-year-minus" title="Ano anterior" aria-label="Ano anterior">−</button>
              <select id="legend-year-selector" aria-label="Selecionar ano do PIB">
                ${availableGdpYears.map(y => `<option value="${escapeHtml(String(y))}" ${y === activeGdpYear ? "selected" : ""}>${escapeHtml(String(y))}</option>`).join("")}
              </select>
              <button type="button" id="gdp-year-plus" title="Próximo ano" aria-label="Próximo ano">+</button>
            </div>
            <select id="legend-gdp-selector">
              ${renderMetricOptions(ANALYSIS_CATALOG.gdp.metrics, activeGdpSubMetric)}
            </select>
          </div>
        ` : (activeAnalysis === "education" ? `
          <div class="flex-gap-4">
            <div class="year-stepper">
              <button type="button" id="enem-year-minus" title="Ano anterior" aria-label="Ano anterior">−</button>
              <select id="legend-enem-year-selector" aria-label="Selecionar ano do ENEM">
                ${availableEnemYears.map(y => `<option value="${escapeHtml(String(y))}" ${y === activeEnemYear ? "selected" : ""}>ENEM ${escapeHtml(String(y))}</option>`).join("")}
              </select>
              <button type="button" id="enem-year-plus" title="Próximo ano" aria-label="Próximo ano">+</button>
            </div>
          </div>
        ` : (activeView === "world" ? `
          <div class="flex-gap-4">
            <select id="world-metric-select" aria-label="Variável">
              ${renderMetricOptions(WORLD_METRIC_CATALOG, activeWorldMetric)}
            </select>
          </div>
        ` : `<strong>${escapeHtml(config.metric)}</strong>`))))}
      </div>
      <div class="legend-scale" id="legend-gradient-scale"></div>
      <div class="legend-labels">
        ${config.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
      ${legendSourceHtml(config.sourceIds)}
    `;

    const gradScale = legend.querySelector("#legend-gradient-scale");
    if (gradScale) {
      gradScale.style.background = `linear-gradient(90deg, ${config.colors.join(", ")})`;
    }

    const sourceInfoButton = legend.querySelector("#source-info-button");
    const sourceDetailPanel = legend.querySelector("#source-detail-panel");
    if (sourceInfoButton && sourceDetailPanel) {
      sourceInfoButton.addEventListener("click", () => {
        const nextExpanded = sourceInfoButton.getAttribute("aria-expanded") !== "true";
        sourceInfoButton.setAttribute("aria-expanded", String(nextExpanded));
        sourceDetailPanel.hidden = !nextExpanded;
      });
    }

    const worldSelector = legend.querySelector("#world-metric-select");
    if (worldSelector) {
      worldSelector.addEventListener("change", (e) => {
        activeWorldMetric = validWorldMetric(e.target.value) ? e.target.value : "pop";
        if (window.updateWorldLayerColor) window.updateWorldLayerColor();
        updateHeatLegend();
        savePreferences();
      });
    }

    const sourceOptionSelector = legend.querySelector("#source-option-select");
    if (sourceOptionSelector) {
      sourceOptionSelector.addEventListener("change", (e) => {
        const options = activeSourceOptions();
        const selected = options.some((option) => option.id === e.target.value) ? e.target.value : options[0]?.id;
        if (selected) activeSourceSelections[activeAnalysis] = selected;
        if (activeAnalysis === "hdi") {
          const years = hdiYearsForActiveView();
          if (activeHdiYear !== "last" && !years.includes(String(activeHdiYear))) activeHdiYear = "last";
          syncHdiToActiveYear();
          updateStateSources();
          if (selectedStateId && stateCitiesCache.has(selectedStateId)) updateMunicipalitySources(stateCitiesCache.get(selectedStateId));
        }
        if (activeAnalysis === "security") {
          if (worldFeatureCollection) {
            hydrateWorldSecurity(worldFeatureCollection);
            setSourceData("world-fill-source", worldFeatureCollection);
          }
        }
        if (window.updateWorldLayerColor) window.updateWorldLayerColor();
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      });
    }

    const hdiYearSelector = legend.querySelector("#legend-hdi-year-selector");
    if (hdiYearSelector) {
      const handleHdiYearChange = (newYear) => {
        activeHdiYear = newYear;
        syncHdiToActiveYear();
        updateStateSources();
        if (selectedStateId && stateCitiesCache.has(selectedStateId)) {
          updateMunicipalitySources(stateCitiesCache.get(selectedStateId));
        }
        if (window.updateWorldLayerColor) window.updateWorldLayerColor();
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      };

      hdiYearSelector.addEventListener("change", (e) => handleHdiYearChange(e.target.value));

      const years = hdiYearsForActiveView();
      const currentIndex = years.indexOf(resolveHdiYear());
      const minusBtn = legend.querySelector("#hdi-year-minus");
      const plusBtn = legend.querySelector("#hdi-year-plus");
      if (minusBtn) {
        minusBtn.disabled = currentIndex >= years.length - 1;
        minusBtn.addEventListener("click", () => {
          if (currentIndex < years.length - 1) handleHdiYearChange(years[currentIndex + 1]);
        });
      }
      if (plusBtn) {
        plusBtn.disabled = currentIndex <= 0;
        plusBtn.addEventListener("click", () => {
          if (currentIndex > 0) handleHdiYearChange(years[currentIndex - 1]);
        });
      }
    }

    const selector = legend.querySelector("#legend-gdp-selector");
    if (selector) {
      selector.addEventListener("change", (e) => {
        activeGdpSubMetric = validAnalysisMetric("gdp", e.target.value) ? e.target.value : ANALYSIS_CATALOG.gdp.defaultMetric;
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      });
    }

    const securitySelector = legend.querySelector("#legend-security-selector");
    if (securitySelector) {
      securitySelector.addEventListener("change", (e) => {
        activeSecuritySubMetric = validAnalysisMetric("security", e.target.value) ? e.target.value : ANALYSIS_CATALOG.security.defaultMetric;
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      });
    }

    const yearSelector = legend.querySelector("#legend-year-selector");
    if (yearSelector) {
      const handleGdpYearChange = async (newYear) => {
        activeGdpYear = newYear;
        syncGdpToActiveYear();
        
        // On-demand fetch for specific year if in cities view
        if (activeView === "cities") {
           const yearInt = parseInt(activeGdpYear, 10);
           const latestOfficialYear = parseInt(LATEST_OFFICIAL_GDP_YEAR, 10);
           const shouldFetchOfficialYear = activeGdpYear === "last" || (!isNaN(yearInt) && yearInt <= latestOfficialYear);
           const resolvedYear = activeGdpYear === "last" || isNaN(yearInt) ? LATEST_OFFICIAL_GDP_YEAR : activeGdpYear;
           // If we don't have this year in history for most cities, fetch it
           if (shouldFetchOfficialYear) {
           try {
             showStatus("Atualizando dados", `Buscando PIB oficial para basear ${resolvedYear}...`);
             const gdpRows = await fetchJson(URLS.cityGdpYear(resolvedYear));
             mergeGdp(gdpRows, cityById);
             
             // Update all state caches if they exist
             stateCitiesCache.forEach(collection => {
                collection.features.forEach(f => {
                   f.properties = { ...f.properties, ...cityMapProperties(f.properties) };
                });
             });
             
             // Re-sync after merge to move data from history to active properties
             syncGdpToActiveYear();
             
             const collection = selectedStateId ? stateCitiesCache.get(selectedStateId) : null;
             if (collection) updateMunicipalitySources(collection);
             
             hideStatus();
           } catch (err) {
             console.warn("Falha ao buscar ano específico", err);
             hideStatus();
           }
           }
        }

        updateStateSources();
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      };

      yearSelector.addEventListener("change", (e) => handleGdpYearChange(e.target.value));

      const minusBtn = legend.querySelector("#gdp-year-minus");
      const plusBtn = legend.querySelector("#gdp-year-plus");
      
      // Years are sorted DESC: ["2025", "2024", ...]
      const currentIndex = availableGdpYears.indexOf(activeGdpYear === "last" ? availableGdpYears[0] : activeGdpYear);
      
      if (minusBtn) {
        minusBtn.disabled = currentIndex >= availableGdpYears.length - 1;
        minusBtn.addEventListener("click", () => {
          if (currentIndex < availableGdpYears.length - 1) handleGdpYearChange(availableGdpYears[currentIndex + 1]);
        });
      }
      if (plusBtn) {
        plusBtn.disabled = currentIndex <= 0;
        plusBtn.addEventListener("click", () => {
          if (currentIndex > 0) handleGdpYearChange(availableGdpYears[currentIndex - 1]);
        });
      }
    }

    const enemYearSelector = legend.querySelector("#legend-enem-year-selector");
    if (enemYearSelector) {
      const handleEnemYearChange = (newYear) => {
        activeEnemYear = newYear;
        updateStateSources();
        if (selectedStateId && stateCitiesCache.has(selectedStateId)) {
          const collection = stateCitiesCache.get(selectedStateId);
          collection.features.forEach(f => {
             f.properties = { ...f.properties, ...cityMapProperties(f.properties) };
          });
          updateMunicipalitySources(collection);
        }
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      };

      enemYearSelector.addEventListener("change", (e) => handleEnemYearChange(e.target.value));

      const minusBtn = legend.querySelector("#enem-year-minus");
      const plusBtn = legend.querySelector("#enem-year-plus");
      
      const currentIndex = availableEnemYears.indexOf(activeEnemYear);
      if (minusBtn) {
        minusBtn.disabled = currentIndex >= availableEnemYears.length - 1;
        minusBtn.addEventListener("click", () => {
          if (currentIndex < availableEnemYears.length - 1) handleEnemYearChange(availableEnemYears[currentIndex + 1]);
        });
      }
      if (plusBtn) {
        plusBtn.disabled = currentIndex <= 0;
        plusBtn.addEventListener("click", () => {
          if (currentIndex > 0) handleEnemYearChange(availableEnemYears[currentIndex - 1]);
        });
      }
    }

    legend.classList.add("visible");
    updateSourceDisplays(config.sourceIds);
  }

  function heatLegendConfig() {
    if (!["states", "cities", "world"].includes(activeView)) return null;

    if (activeAnalysis === "hdi") {
      const year = resolveHdiYear();
      const isWorld = activeView === "world";
      const isCity = activeView === "cities" && selectedStateId;
      return {
        metric: `${isWorld ? "IDH" : "IDHM"} ${year || ""}`,
        scope: isWorld ? "Global" : (isCity ? "cidades da UF (proxy)" : "estados"),
        colors: ["#17212b", "#335c67", "#4f8f70", "#a9d65c", "#f2c14e"],
        labels: ["baixo", "médio", "alto", "muito alto", "topo"],
        sourceIds: isWorld ? (activeSourceOption("hdi", "world")?.sourceIds || ["hdiGlobalUndp"]) : (isCity ? ["idhmPnudBrazil", "idhmCityProxy"] : ["idhmPnudBrazil"]),
        isWorld
      };
    }

    const scope = activeView === "cities" && selectedStateId ? "city" : "state";
    const isCity = scope === "city";
    const scale = isCity ? getCityScaleMetrics(activeAnalysis) : null;
    
    const formatLabel = (val, type) => {
       if (val == null) return "";
       if (type === "pop") return formatShort(val);
       if (type === "gdp") return formatCurrencyShort(val);
       if (type === "edu") return val.toFixed(1);
       if (type === "pol") return formatShort(val);
       if (type === "sec") return val.toFixed(1);
       return val;
    };

    if (activeAnalysis === "education") {
      return {
        metric: `Nota média ENEM ${activeEnemYear}`,
        scope: isCity ? "cidades da UF (relativo)" : "estados",
        colors: ["#5c1514", "#ef7d60", "#f2c14e", "#a9d65c", "#51d1c2", "#3a8fc7"],
        labels: (scale && scale.max > scale.min) 
          ? [formatLabel(scale.min, "edu"), "...", formatLabel(scale.max, "edu")]
          : ["509", "520", "535", "548 (BR≈)", "569+"]
      };
    }
    if (activeAnalysis === "gdp") {
      const gdpYearNumber = parseInt(activeGdpYear, 10);
      const yearText = gdpYearNumber > parseInt(LATEST_OFFICIAL_GDP_YEAR, 10) ? `${activeGdpYear} (proj.)` : activeGdpYear;
      return {
        metric: activeGdpSubMetric === "total" ? `PIB Total ${yearText}` : `PIB por habitante ${yearText}`,
        scope: isCity ? "cidades da UF (relativo)" : "estados",
        colors: ["#17212b", "#23534d", "#79a95d", "#f2c14e", "#ef7d60"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "gdp"), "...", formatLabel(scale.max, "gdp")]
          : isCity ? ["menor", "R$ 80 mil/hab.", "R$ 180 mil+"] : ["menor", "R$ 42 mil/hab.", "R$ 120 mil+"]
      };
    }

    if (activeAnalysis === "politics") {
      return {
        metric: "Habitantes por político",
        scope: isCity ? "cidades da UF (relativo)" : "estados",
        colors: ["#16212b", "#29515d", "#51d1c2", "#f2c14e", "#ef7d60"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "pol"), "...", formatLabel(scale.max, "pol")]
          : isCity ? ["menos gente", "25 mil", "180 mil+"] : ["1 mil", "5 mil", "8 mil+"]
      };
    }

    if (activeAnalysis === "travel") {
      return {
        metric: "Cidades documentadas",
        scope: isCity ? "locais com vídeo" : "estados visitados",
        colors: ["#17212b", "#f2c14e"],
        labels: ["Sem vídeos", "Com documentários"]
      };
    }

    if (activeAnalysis === "security") {
      if (activeView === "world") {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          return {
            metric: "Global Peace Index",
            scope: "Global",
            colors: ["#1a5f8a", "#4f8f70", "#a9d65c", "#f2c14e", "#ef7d60", "#ff3b3b"],
            labels: ["1.0 (paz)", "1.5", "2.0", "2.5", "3.0", "3.5+ (conflito)"],
            sourceIds: ["securityGlobalGpi"],
            isWorld: true
          };
        }
        return {
          metric: "Homicídios por 100k habitantes",
          scope: "Global",
          colors: ["#17212b", "#5c3a1e", "#a0522d", "#ef7d60", "#ff3b3b"],
          labels: ["0", "5", "15", "30", "50+"],
          sourceIds: ["securityGlobalUnodc"],
          isWorld: true
        };
      }
      const metricLabels = {
        mviRate: "MVI por 100k",
        vehicleTheftRate: "Roubo veículos por 100k",
        femicideRate: "Feminicídio por 100k",
        domesticViolenceRate: "Violência doméstica por 100k"
      };
      const metric = activeSecuritySubMetric || "mviRate";
      const metricStops = {
        mviRate: isCity ? ["0", "15", "30", "45", "60+"] : ["0", "12", "24", "38", "55+"],
        vehicleTheftRate: isCity ? ["0", "80", "160", "240", "320+"] : ["0", "60", "120", "180", "260+"],
        femicideRate: isCity ? ["0", "1", "2", "3", "5+"] : ["0", "1", "1.5", "2.5", "4+"],
        domesticViolenceRate: isCity ? ["0", "25", "45", "60", "75+"] : ["0", "20", "35", "50", "65+"]
      };
      const scopeLabel = isCity ? "cidades da UF (IPEA + proxy)" : "estados";
      return {
        metric: metricLabels[metric] || "MVI por 100k",
        scope: scopeLabel,
        colors: ["#17212b", "#5c3a1e", "#a0522d", "#ef7d60", "#ff3b3b"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "sec"), "...", formatLabel(scale.max, "sec")]
          : (metricStops[metric] || metricStops.mviRate),
        sourceIds: isCity ? ["securityBrazilFBSP", "securityBrazilIPEACities", "securityBrazilCityProxy"] : ["securityBrazilFBSP"]
      };
    }

    if (activeView === "world") {
      let labels, metricLabel;
      if (activeWorldMetric === "pop") { metricLabel = "População"; labels = ["<1mi", "10mi", "50mi", "200mi", "1bi+"]; }
      else if (activeWorldMetric === "area") { metricLabel = "Área territorial"; labels = ["Pequeno", "Médio", "Grande", "Gigante", "Continental"]; }
      else if (activeWorldMetric === "density") { metricLabel = "Densidade pop."; labels = ["<10", "50", "150", "500", "1000+"]; }
      else if (activeWorldMetric === "gdp") { metricLabel = "PIB US$ (2024)"; labels = ["<10bi", "100bi", "500bi", "2tri", "10tri+"]; }
      else if (activeWorldMetric === "gdpPerCapita") { metricLabel = "PIB per capita US$ (24)"; labels = ["<2k", "5k", "15k", "35k", "60k+"]; }
      
      return {
        metric: metricLabel,
        scope: "Global",
        colors: ["#17212b", "#25534e", "#5b8e54", "#c59b3f", "#ef7d60", "#b799ff"],
        labels: labels,
        sourceIds: (WORLD_METRIC_CATALOG[activeWorldMetric] || WORLD_METRIC_CATALOG.pop).sourceIds,
        isWorld: true
      };
    }

    return {
      metric: "População",
      scope: isCity ? "cidades da UF (relativo)" : "estados",
      colors: isCity
        ? ["#17212b", "#25534e", "#5b8e54", "#c59b3f", "#ef7d60", "#b799ff"]
        : ["#17212b", "#25534e", "#5b8e54", "#c59b3f", "#ef7d60"],
      labels: (scale && scale.max > scale.min)
        ? [formatLabel(scale.min, "pop"), "...", formatLabel(scale.max, "pop")]
        : isCity ? ["menos", "500 mil", "11 mi+"] : ["600 mil", "8 mi", "44 mi+"]
    };
  }

  function bindMapLayerEvents() {
    if (map.getLayer("brazil-fill") && !map.__boundBrazilLayer) {
      map.__boundBrazilLayer = true;
      map.on("click", "brazil-fill", (event) => {
        scheduleBrazilClick(event.lngLat);
      });
      map.on("dblclick", "brazil-fill", (event) => {
        if (event.preventDefault) event.preventDefault();
        clearPendingBrazilClick();
        clearHoverPopup();
        if (fixedPopup) fixedPopup.remove();
        fixedPopup = null;
        setActiveView("states");
        enterStateAnalysisMode({ selectBrazil: true });
      });
      map.on("mousemove", "brazil-fill", (event) => {
        if (!event.features.length || activeView !== "brazil") return;
        map.getCanvas().style.cursor = "pointer";
        showBrazilHover(event.lngLat);
      });
      map.on("mouseleave", "brazil-fill", () => {
        map.getCanvas().style.cursor = "";
        clearHoverPopup();
      });
    }

    ["states-fill", "states-bubbles"].forEach((layerId) => {
      if (!map.getLayer(layerId) || map.__boundStateLayers?.has(layerId)) return;
      map.__boundStateLayers = map.__boundStateLayers || new Set();
      map.__boundStateLayers.add(layerId);
      map.on("click", layerId, (event) => {
        if (stateClickShouldYieldToCity(event)) return;
        const props = event.features[0].properties;
        scheduleStateClick(event.lngLat, props);
      });
      map.on("dblclick", layerId, (event) => {
        if (event.preventDefault) event.preventDefault();
        const props = event.features[0].properties;
        clearPendingStateClick();
        clearHoverPopup();
        if (fixedPopup) fixedPopup.remove();
        fixedPopup = null;
        setActiveView("cities");
        loadStateCities(props.id);
      });
      map.on("mousemove", layerId, (event) => {
        if (!event.features.length) return;
        if (isStreetMode) {
          map.getCanvas().style.cursor = "";
          clearHoverPopup();
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        showStateHover(event.lngLat, event.features[0].properties);
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
        clearHoverPopup();
      });
    });

    ["municipality-fill", "municipality-bubbles"].forEach((layerId) => {
      if (!map.getLayer(layerId) || map.__boundCityLayers?.has(layerId)) return;
      map.__boundCityLayers = map.__boundCityLayers || new Set();
      map.__boundCityLayers.add(layerId);
      map.on("click", layerId, (event) => {
        const props = event.features[0].properties;
        clearPendingStateClick();
        clearHoverPopup();
        let fullFeature = event.features[0];
        if (selectedStateId && stateCitiesCache.has(selectedStateId)) {
          const collection = stateCitiesCache.get(selectedStateId);
          const found = collection.features.find(f => f.properties.id === String(props.id));
          if (found) fullFeature = found;
        }
        selectCity(props.id, fullFeature);
        showMunicipalityPopup(event.lngLat, props);
      });
      map.on("dblclick", layerId, (event) => {
        if (event.preventDefault) event.preventDefault();
        const props = event.features[0].properties;
        clearPendingStateClick();
        clearHoverPopup();
        let fullFeature = event.features[0];
        if (selectedStateId && stateCitiesCache.has(selectedStateId)) {
          const collection = stateCitiesCache.get(selectedStateId);
          const found = collection.features.find(f => f.properties.id === String(props.id));
          if (found) fullFeature = found;
        }
        selectCity(props.id, fullFeature, { fly: false });
        showMunicipalityPopup(event.lngLat, props);
        setActiveView("street");
        flyToStreet();
      });
      map.on("mousemove", layerId, (event) => {
        if (!event.features.length) return;
        if (isStreetMode) {
          map.getCanvas().style.cursor = "";
          clearHoverPopup();
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        showMunicipalityHover(event.lngLat, event.features[0].properties);
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
        clearHoverPopup();
      });
    });
  }

  function stateClickShouldYieldToCity(event) {
    if (activeView !== "cities") return false;
    const layers = ["municipality-fill", "municipality-bubbles"].filter((layerId) => map.getLayer(layerId));
    if (!layers.length) return false;
    try {
      return map.queryRenderedFeatures(event.point, { layers }).length > 0;
    } catch (error) {
      return false;
    }
  }

  function scheduleBrazilClick(lngLat) {
    clearPendingBrazilClick();
    brazilClickTimer = window.setTimeout(() => {
      brazilClickTimer = null;
      clearHoverPopup();
      renderSelectedBrazil();
      showBrazilPopup(lngLat);
    }, 240);
  }

  function clearPendingBrazilClick() {
    if (brazilClickTimer) window.clearTimeout(brazilClickTimer);
    brazilClickTimer = null;
  }

  function scheduleStateClick(lngLat, props) {
    clearPendingStateClick();
    stateClickTimer = window.setTimeout(() => {
      stateClickTimer = null;
      clearHoverPopup();
      const state = stateById.get(String(props.id));
      if (state) selectStateUi(state);
      showStatePopup(lngLat, props);
    }, 240);
  }

  function clearPendingStateClick() {
    if (stateClickTimer) window.clearTimeout(stateClickTimer);
    stateClickTimer = null;
  }

  function addBaseLayers() {
    if (!map.getSource("satellite-source")) {
      map.addSource("satellite-source", {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Tiles © Esri"
      });
    }
    addLayerOnce({
      id: "satellite-layer",
      type: "raster",
      source: "satellite-source",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 1 }
    }, firstLineOrSymbolLayerId());
  }

  function setBaseMode(mode) {
    activeBaseMode = mode;
    const showSatellite = mode === "earth" || mode === "hybrid";
    if (map.getLayer("satellite-layer")) {
      map.setLayoutProperty("satellite-layer", "visibility", showSatellite ? "visible" : "none");
    }

    const style = map.getStyle();
    const layers = style ? style.layers || [] : [];
    layers.forEach((layer) => {
      if (layer.id === "satellite-layer" || isAtlasLayer(layer.id)) return;
      let visible = true;
      if (mode === "earth") {
        visible = false;
      } else if (mode === "hybrid") {
        visible = !["background", "fill", "fill-extrusion", "hillshade", "raster"].includes(layer.type);
      }
      try { map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none"); } catch (error) {}
    });
    tuneBaseMapPaint(mode);
    setBaseAdministrativeBoundariesVisible(activeView !== "brazil");
    savePreferences();
  }

  function tuneBaseMapPaint(mode) {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (layer.id === "satellite-layer" || isAtlasLayer(layer.id)) return;
      rememberBaseLayerPaint(layer);

      if (mode === "map") {
        restoreBaseLayerPaint(layer);
        tuneLightMapLayer(layer);
      } else if (mode === "hybrid") {
        restoreBaseLayerPaint(layer);
        tuneHybridMapLayer(layer);
      }
    });
  }

  function tuneLightMapLayer(layer) {
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#eef3ee");
      }
      if (layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-opacity", 0.92);
      }
      if (layer.type === "line") {
        map.setPaintProperty(layer.id, "line-opacity", 0.86);
      }
      if (layer.type === "symbol") {
        if (hasPaintProperty(layer, "text-color")) map.setPaintProperty(layer.id, "text-color", "#23313a");
        if (hasPaintProperty(layer, "text-halo-color")) map.setPaintProperty(layer.id, "text-halo-color", "#ffffff");
        if (hasPaintProperty(layer, "text-halo-width")) map.setPaintProperty(layer.id, "text-halo-width", 1.4);
      }
    } catch (error) {}
  }

  function tuneHybridMapLayer(layer) {
    try {
      if (layer.type === "line") {
        if (hasPaintProperty(layer, "line-color")) map.setPaintProperty(layer.id, "line-color", hybridLineColor(layer));
        if (hasPaintProperty(layer, "line-opacity")) map.setPaintProperty(layer.id, "line-opacity", 0.62);
      }
      if (layer.type === "symbol") {
        if (hasPaintProperty(layer, "text-color")) map.setPaintProperty(layer.id, "text-color", "#ffffff");
        if (hasPaintProperty(layer, "text-halo-color")) map.setPaintProperty(layer.id, "text-halo-color", "#07121b");
        if (hasPaintProperty(layer, "text-halo-width")) map.setPaintProperty(layer.id, "text-halo-width", 2.2);
        if (hasPaintProperty(layer, "text-opacity")) map.setPaintProperty(layer.id, "text-opacity", 1);
      }
    } catch (error) {}
  }

  function hybridLineColor(layer) {
    if (/motorway|trunk|primary|secondary|tertiary|road|street|highway|transport/i.test(layer.id)) {
      return "#172027";
    }
    return "#24313a";
  }

  function hasPaintProperty(layer, property) {
    return layer.paint && Object.prototype.hasOwnProperty.call(layer.paint, property);
  }

  function rememberBaseLayerPaint(layer) {
    if (basePaintByLayer.has(layer.id)) return;
    const paint = {};
    [
      "background-color",
      "fill-opacity",
      "line-color",
      "line-opacity",
      "text-color",
      "text-halo-color",
      "text-halo-width",
      "text-opacity"
    ].forEach((property) => {
      if (!hasPaintProperty(layer, property)) return;
      try { paint[property] = map.getPaintProperty(layer.id, property); } catch (error) {}
    });
    basePaintByLayer.set(layer.id, paint);
  }

  function restoreBaseLayerPaint(layer) {
    const paint = basePaintByLayer.get(layer.id);
    if (!paint) return;
    Object.entries(paint).forEach(([property, value]) => {
      try { map.setPaintProperty(layer.id, property, value); } catch (error) {}
    });
  }

  function setBaseAdministrativeBoundariesVisible(visible) {
    const shouldShow = visible && activeBaseMode !== "earth";
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (!isBaseAdministrativeBoundaryLayer(layer)) return;
      try { map.setLayoutProperty(layer.id, "visibility", shouldShow ? "visible" : "none"); } catch (error) {}
    });
  }

  function isBaseAdministrativeBoundaryLayer(layer) {
    if (!layer || layer.type !== "line") return false;
    if (layer.id === "satellite-layer" || isAtlasLayer(layer.id)) return false;
    return /admin|boundary|border|country|province|state|subdivision/i.test(layer.id);
  }

  function isAtlasLayer(id) {
    return id.startsWith("brazil-") || id.startsWith("states-") || id.startsWith("selected-state") || id.startsWith("municipality-") || id.startsWith("world-") || id.startsWith("selected-country");
  }

  function setLayerVisibility(group, visible) {
    const prefix = group === "municipality" ? "municipality-" : "states-";
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (layer.id.startsWith(prefix)) {
        map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
      }
    });
  }

  function setLayersVisibility(layerIds, visible) {
    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    });
  }

  function hideAtlasAnalysisLayers() {
    setLayersVisibility([
      "states-fill",
      "states-outline",
      "states-bubbles",
      "states-labels",
      "selected-state-fill",
      "selected-state-glow-outer",
      "selected-state-outline",
      "municipality-fill",
      "municipality-outline",
      "municipality-bubbles",
      "municipality-labels"
    ], false);
  }

  function setBrazilLayerVisibility(visible) {
    setLayersVisibility(["brazil-fill"], visible);
    setLayersVisibility(["brazil-outline"], visible && Boolean(brazilMeshFeature));
    setBaseAdministrativeBoundariesVisible(!visible);
  }

  function hideAtlasLayersForStreet() {
    hideAtlasAnalysisLayers();
    setBrazilLayerVisibility(false);
    setWorldLayerVisibility(false);
  }

  function setWorldLayerVisibility(visible) {
    setLayersVisibility(["world-fill", "world-outline", "selected-country-fill", "selected-country-glow-outer", "selected-country-outline"], visible);
  }

  function syncAtlasLayersForActiveView() {
    const hasWorld = Boolean(map.getLayer("world-fill"));
    if (activeView === "world") {
      setBrazilLayerVisibility(false);
      hideAtlasAnalysisLayers();
      if (hasWorld) setWorldLayerVisibility(true);
      return;
    }
    
    // Default: hide world if not in world view
    if (hasWorld) setWorldLayerVisibility(false);

    if (activeView === "brazil") {
      setBrazilLayerVisibility(true);
      hideAtlasAnalysisLayers();
      if (activeAnalysis === "travel") {
        setLayersVisibility(["states-bubbles", "states-labels"], true);
      }
      return;
    }

    if (activeView === "states") {
      setBrazilLayerVisibility(false);
      setLayerVisibility("states", true);
      setLayersVisibility(["selected-state-fill", "selected-state-glow-outer", "selected-state-outline"], true);
      setLayerVisibility("municipality", false);
      return;
    }

    if (activeView === "cities") {
      setBrazilLayerVisibility(false);
      setLayerVisibility("states", true);
      setLayersVisibility(["selected-state-fill", "selected-state-glow-outer", "selected-state-outline"], true);
      setLayerVisibility("municipality", Boolean(selectedStateId));
      return;
    }

    if (activeView === "street") {
      hideAtlasLayersForStreet();
      return;
    }

    setBrazilLayerVisibility(false);
    hideAtlasAnalysisLayers();
  }

  function restoreBaseLabels() {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (layer.id === "satellite-layer" || isAtlasLayer(layer.id)) return;
      if (layer.type === "line" || layer.type === "symbol") {
        try { map.setLayoutProperty(layer.id, "visibility", "visible"); } catch (error) {}
      }
    });
    tuneBaseMapPaint("hybrid");
  }

  function bindControls() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        if (view === "world") {
          enterWorldMode();
        } else {
          setActiveView(view);
        }
        setActiveView(view);
        if (view === "world") {
          clearHoverPopup();
          if (fixedPopup) fixedPopup.remove();
//           fixedPopup = null;
          syncAtlasLayersForActiveView();
          map.flyTo({ center: [-30, 0], zoom: 1.55, speed: 0.8, curve: 1.35, essential: true });
        }
        if (view === "brazil") {
          enterBrazilOverviewMode();
        }
        if (view === "states") {
          enterStateAnalysisMode({ selectBrazil: true });
        }
        if (view === "cities") {
          if (selectedStateId) {
            loadStateCities(selectedStateId);
          } else {
            enterCitiesChooserMode();
          }
        }
        if (view === "street") {
          flyToStreet();
        }
      });
    });

    document.querySelectorAll("[data-base]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveButton("[data-base]", button);
        setBaseMode(button.dataset.base);
      });
    });

    document.querySelectorAll("[data-projection]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveButton("[data-projection]", button);
        activeProjection = button.dataset.projection;
        try { map.setProjection({ type: activeProjection }); } catch (error) { console.warn(error); }
        savePreferences();
      });
    });

    document.querySelectorAll("[data-analysis]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveAnalysis(button.dataset.analysis);
      });
    });

    if (elements["hover-cards-toggle"]) {
      elements["hover-cards-toggle"].addEventListener("click", () => {
        setHoverCardsEnabled(!hoverCardsEnabled);
        savePreferences();
      });
    }

    elements.search.addEventListener("input", renderSearch);
    elements.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        elements.search.value = "";
        renderSearch();
      }
    });
  }

  function setActiveView(view) {
    activeView = view;
    const button = document.querySelector(`[data-view="${view}"]`);
    if (button) setActiveButton("[data-view]", button);
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function setActiveAnalysis(analysis) {
    activeAnalysis = validAnalysis(analysis) ? analysis : "general";
    const config = activeAnalysisConfig();
    if (config.metrics && !validAnalysisMetric(activeAnalysis, activeGdpSubMetric)) {
      activeGdpSubMetric = config.defaultMetric || Object.keys(config.metrics)[0];
    }
    const button = document.querySelector(`[data-analysis="${activeAnalysis}"]`);
    if (button) setActiveButton("[data-analysis]", button);
    if (elements["analysis-caption"]) elements["analysis-caption"].textContent = analysisLabel(activeAnalysis);
    updateSourceDisplays();
    updateAnalysisPaint();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    syncAtlasLayersForActiveView();
    refreshAnalysisContent();
    // Keep the card open and refresh its content for the new analysis tab
    refreshFixedDetailCard();
    savePreferences();
  }

  function refreshAnalysisContent() {
    if (activeView === "world") {
      renderSelectedWorld();
      renderStateChart();
      renderEmptyRanking("Selecione um país no mapa para ver os detalhes globais.");
      return;
    }

    if (selectedCityFeature) {
      selectCity(selectedCityFeature.properties.id, selectedCityFeature, { fly: false });
    } else if (selectedStateId && stateById.has(selectedStateId)) {
      selectStateUi(stateById.get(selectedStateId));
    } else {
      renderSelectedBrazil();
    }

    const collection = selectedStateId ? stateCitiesCache.get(selectedStateId) : null;
    if (collection) {
      renderMunicipalityChart(collection);
      renderMunicipalityRanking(collection);
    } else {
      renderStateChart();
      renderEmptyRanking();
    }
  }

  async function restoreAtlasView() {
    const preserveCamera = Boolean(savedCamera);
    applyPreferenceControls();

    if (activeView === "world") {
      setActiveView("world");
      await enterWorldMode({ preserveCamera });
    } else if (activeView === "states") {
      setActiveView("states");
      enterStateAnalysisMode({ selectBrazil: true, preserveCamera });
    } else if (activeView === "cities") {
      setActiveView("cities");
      if (savedPreferences.selectedStateId && stateById.has(String(savedPreferences.selectedStateId))) {
        await loadStateCities(savedPreferences.selectedStateId, savedPreferences.selectedCityId, { preserveCamera });
      } else {
        enterCitiesChooserMode({ preserveCamera });
      }
    } else if (activeView === "street") {
      setActiveView("street");
      if (savedPreferences.selectedStateId && stateById.has(String(savedPreferences.selectedStateId))) {
        await loadStateCities(savedPreferences.selectedStateId, savedPreferences.selectedCityId, { preserveCamera: true });
      }
      flyToStreet({ preserveCamera });
    } else {
      setActiveView("brazil");
      enterBrazilOverviewMode({ preserveCamera });
    }

    if (savedCamera) restoreMapCamera(savedCamera);
    savePreferences();
  }

  function enterBrazilOverviewMode(options = {}) {
    isStreetMode = false;
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    selectedStateId = null;
    selectedCityId = null;
    selectedCityFeature = null;
    clearSelectedCitySource();
    updateSelectedStateSource();
    setBrazilLayerVisibility(true);
    hideAtlasAnalysisLayers();
    elements["hud-layer"].textContent = "Brasil";
    elements["metric-state"].textContent = "Brasil";
    elements["metric-state-pop"].textContent = formatNumber(totalPopulation);
    elements["metric-city"].textContent = "visão nacional";
    elements["metric-city-pop"].textContent = "dados gerais do país";
    renderSelectedBrazil();
    renderStateChart();
    renderEmptyRanking("A visão Brasil mostra o país como um território único. Use Estados para comparar UFs ou Cidades para detalhar cidades.");
    if (!options.preserveCamera) fitBrazil();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function enterStateAnalysisMode(options = {}) {
    isStreetMode = false;
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    selectedStateId = null;
    selectedCityId = null;
    selectedCityFeature = null;
    clearSelectedCitySource();
    updateSelectedStateSource();
    setBrazilLayerVisibility(false);
    setLayerVisibility("states", true);
    setLayersVisibility(["selected-state-fill", "selected-state-glow-outer", "selected-state-outline"], true);
    setLayerVisibility("municipality", false);
    elements["hud-layer"].textContent = "Estados";
    elements["metric-state"].textContent = "Brasil";
    elements["metric-state-pop"].textContent = "passe o mouse nos estados";
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "duplo clique em uma UF";
    if (options.selectBrazil) renderSelectedBrazil();
    renderStateChart();
    renderEmptyRanking("Passe o mouse sobre um estado para ler os dados. Dê duplo clique em uma UF para explorar suas cidades.");
    if (!options.preserveCamera) fitBrazil();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function enterCitiesChooserMode(options = {}) {
    isStreetMode = false;
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    selectedStateId = null;
    selectedCityId = null;
    selectedCityFeature = null;
    updateSelectedStateSource();
    setBrazilLayerVisibility(false);
    setLayerVisibility("states", true);
    setLayersVisibility(["selected-state-fill", "selected-state-glow-outer", "selected-state-outline"], true);
    setLayerVisibility("municipality", false);
    elements["hud-layer"].textContent = "Cidades";
    elements["metric-state"].textContent = "Brasil";
    elements["metric-state-pop"].textContent = "duplo clique em uma UF";
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "escolha um estado";
    renderSelectedBrazil();
    renderStateChart();
    renderEmptyRanking("Dê duplo clique em uma UF para carregar as cidades antes de entrar no detalhe.");
    if (!options.preserveCamera) fitBrazil();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function enterCityAnalysisMode() {
    isStreetMode = false;
    setActiveView("cities");
    setBrazilLayerVisibility(false);
    setLayerVisibility("states", true);
    setLayersVisibility(["selected-state-fill", "selected-state-glow-outer", "selected-state-outline"], true);
    setLayerVisibility("municipality", true);
    updateSelectedStateSource();
    elements["hud-layer"].textContent = "Cidades";
    updateAnalysisPaint();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function renderSearch() {
    const query = normalizeText(elements.search.value);
    const box = elements["search-results"];
    if (query.length < 2) {
      box.classList.remove("visible");
      box.innerHTML = "";
      return;
    }

    const stateMatches = Array.from(stateById.values())
      .filter((state) => normalizeText(`${state.nome} ${state.sigla}`).includes(query))
      .slice(0, 4)
      .map((state) => ({
        type: "state",
        id: state.id,
        title: `${state.nome} (${state.sigla})`,
        meta: state.regiao,
        pop: state.pop
      }));

    const cityMatches = Array.from(cityById.values())
      .filter((city) => normalizeText(`${city.nome} ${city.uf} ${city.stateName}`).includes(query))
      .sort((a, b) => (b.pop || 0) - (a.pop || 0))
      .slice(0, 7)
      .map((city) => ({
        type: "city",
        id: city.id,
        stateId: city.stateId,
        title: `${city.nome} (${city.uf})`,
        meta: city.stateName,
        pop: city.pop
      }));

    const matches = [...stateMatches, ...cityMatches].slice(0, 9);
    if (!matches.length) {
      box.classList.add("visible");
      box.innerHTML = `<div class="empty">Nenhum território encontrado para essa busca.</div>`;
      return;
    }

    box.classList.add("visible");
    box.innerHTML = matches.map((item) => `
      <button type="button" class="result-btn" data-type="${item.type}" data-id="${item.id}" data-state-id="${item.stateId || item.id}">
        <span>
          <span class="result-name">${escapeHtml(item.title)}</span>
          <span class="result-meta">${escapeHtml(item.type === "state" ? "Unidade da Federação" : item.meta || "Cidade")}</span>
        </span>
        <span class="result-pop">${formatShort(item.pop || 0)}</span>
      </button>
    `).join("");

    box.querySelectorAll(".result-btn").forEach((button) => {
      button.addEventListener("click", () => {
        elements.search.value = "";
        renderSearch();
        if (button.dataset.type === "state") {
          loadStateCities(button.dataset.id);
        } else {
          loadStateCities(button.dataset.stateId, button.dataset.id);
        }
      });
    });
  }

  function renderBrazilMetrics() {
    elements["metric-br-pop"].textContent = formatNumber(totalPopulation);
    elements["metric-city-count"].textContent = cityById.size ? `${formatNumber(cityById.size)} cidades` : "cidades ao carregar";
  }

  function renderSelectedBrazil() {
    elements["selected-code"].textContent = "BR";
    elements["selected-type"].textContent = "Brasil";
    elements["selected-name"].textContent = "Brasil";
    elements["selected-pop"].textContent = formatNumber(totalPopulation);
    elements["selected-share"].textContent = "100%";
    const area = brazilMeshFeature ? brazilMeshFeature.properties.areaKm2 : null;
    elements["selected-area"].textContent = formatArea(area);
    elements["selected-density"].textContent = formatDensity(area ? totalPopulation / area : null);
    elements["selected-rank"].textContent = "-";
    elements["selected-context"].textContent = "27 UF";
    renderGeneralPanel("brazil");
  }

  function selectStateUi(state) {
    selectedStateId = String(state.id);
    elements["metric-state"].textContent = state.sigla;
    elements["metric-state-pop"].textContent = formatNumber(state.pop || 0);
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "selecione no mapa";
    elements["selected-code"].textContent = state.id;
    elements["selected-type"].textContent = "Unidade da Federação";
    elements["selected-name"].textContent = `${state.nome} (${state.sigla})`;
    elements["selected-pop"].textContent = formatNumber(state.pop || 0);
    elements["selected-share"].textContent = percent((state.pop || 0) / totalPopulation);
    const feature = stateFeatureById.get(state.id);
    const area = feature ? feature.properties.areaKm2 : null;
    elements["selected-area"].textContent = formatArea(area);
    elements["selected-density"].textContent = formatDensity(area ? (state.pop || 0) / area : null);
    elements["selected-rank"].textContent = rankText(Array.from(stateById.values()), state.id);
    elements["selected-context"].textContent = state.regiao || "Brasil";
    renderGeneralPanel("state", state);
    updateSelectedStateSource();
    savePreferences();
  }

  async function selectCity(cityId, feature, options = {}) {
    const city = cityById.get(String(cityId));
    if (city) {
      const year = activeGdpYear === "last" ? (availableGdpYears[0] || "") : activeGdpYear;
      if (city.gdpHistory && city.gdpHistory[year]) {
        feature.properties.gdp = city.gdpHistory[year];
        feature.properties.gdpYear = year;
      }
      feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
    }
    
    const props = feature.properties;
    selectedCityId = String(cityId);
    selectedCityFeature = feature;
    updateSelectedCitySource(feature);

    // Fetch history asynchronously if not present
    if (city && (!city.gdpHistory || Object.keys(city.gdpHistory).length < 5)) {
      fetchJson(URLS.municipalityGdpHistory(selectedCityId)).then(gdpRows => {
        mergeGdp(gdpRows, cityById);
        const cityObj = cityById.get(selectedCityId);
        if (cityObj && cityObj.gdpHistory) mockGdpProjections(cityObj.gdpHistory);
        // Update feature properties with new history
        feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
        // Only refresh if still selected
        if (selectedCityId === cityId) {
          renderGeneralPanel("city", feature.properties);
        }
      }).catch(err => console.warn("Erro ao carregar histórico da cidade", err));
    }

    elements["metric-city"].textContent = props.name;
    elements["metric-city-pop"].textContent = formatNumber(props.pop || 0);
    elements["selected-code"].textContent = props.id;
    elements["selected-type"].textContent = "Cidade";
    elements["selected-name"].textContent = `${props.name} (${props.uf})`;
    elements["selected-pop"].textContent = formatNumber(props.pop || 0);
    const state = stateById.get(String(props.stateId));
    elements["selected-share"].textContent = state ? percent((props.pop || 0) / (state.pop || 1)) : "-";
    const area = props.areaKm2;
    elements["selected-area"].textContent = formatArea(area);
    elements["selected-density"].textContent = formatDensity(area ? (props.pop || 0) / area : null);
    elements["selected-rank"].textContent = props.rank ? `${props.rank}º na UF` : "-";
    elements["selected-context"].textContent = props.stateName || props.uf;
    renderGeneralPanel("city", props);
    updateRankingActive();
    if (options.fly !== false) {
      map.flyTo({ center: [props.lng, props.lat], zoom: Math.max(map.getZoom(), 7.4), pitch: 0, speed: 0.8, curve: 1.3, essential: true });
    }
    // If the Info Panel is already open, update it for the newly selected city
    if (currentFixedCard) {
      showMunicipalityPopup(null, props);
    }
    savePreferences();
  }

  function renderGeneralPanel(scope, data) {
    updateSourceDisplays();
    if (scope === "state") {
      renderGeneralCards(`${data.nome} | ${data.sigla}`, analysisCards("state", data));
      elements["general-note"].textContent = analysisNote();
      return;
    }

    if (scope === "city") {
      renderGeneralCards(`${data.name} | ${data.uf}`, analysisCards("city", data));
      elements["general-note"].textContent = analysisNote();
      return;
    }

    renderGeneralCards("Brasil", analysisCards("brazil"));
    elements["general-note"].textContent = analysisNote();
  }

  function renderGdpHistoryChart(history) {
    if (!history) return "";
    let years = Object.keys(history).sort((a, b) => Number(a) - Number(b));
    if (years.length < 2) return "";
    
    // Only show last 15 years to avoid saturation
    const maxYears = 15;
    if (years.length > maxYears) {
      years = years.slice(years.length - maxYears);
    }

    const numericValues = years.map(y => Number(history[y]) || 0);
    const max = Math.max(...numericValues, 1);
    const resolvedActiveYear = activeGdpYear === "last" ? (availableGdpYears[0] || "") : activeGdpYear;
    return `
      <div class="mt-12 pt-10 border-top-line w-full">
        <div class="pib-history-header">Histórico do PIB</div>
        <div class="pib-history-container" id="gdp-history-chart">
          ${years.map(y => {
            const val = Number(history[y]) || 0;
            const h = Math.max(8, (val / max) * 100);
            const isActive = String(y) === String(resolvedActiveYear);
            const isMock = parseInt(y) >= 2023;
            return `<div class="pib-history-bar" title="${y}${isMock ? ' (proj.)' : ''}: ${formatCurrencyShort(val)}" data-h="${h}" data-active="${isActive}" data-mock="${isMock}"></div>`;
          }).join("")}
        </div>
        <div class="pib-history-footer">
          <span>${escapeHtml(String(years[0]))}</span>
          <span>${escapeHtml(String(years[years.length-1]))}</span>
        </div>
      </div>
    `;
  }

  function renderHdiHistoryChart(history, activeYear = resolveHdiYear(), isProxy = false) {
    if (!history) return "";
    let years = Object.keys(history).sort((a, b) => Number(a) - Number(b));
    if (years.length < 2) return "";

    const maxYears = 18;
    if (years.length > maxYears) {
      years = years.slice(years.length - maxYears);
    }

    const values = years.map((year) => hdiValueForYear(history, year)).filter((value) => value > 0);
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 0.01);

    return `
      <div class="mt-12 pt-10 border-top-line w-full">
        <div class="pib-history-header">${isProxy ? "Histórico IDHM da UF usada como proxy" : "Histórico do IDH"}</div>
        <div class="pib-history-container" id="hdi-history-chart">
          ${years.map((year) => {
            const val = hdiValueForYear(history, year);
            const h = Math.max(8, ((val - min) / span) * 92 + 8);
            const isActive = String(year) === String(activeYear);
            return `<div class="pib-history-bar" title="${year}: ${formatHdi(val)}${isProxy ? ' (proxy UF)' : ''}" data-kind="hdi" data-h="${h}" data-active="${isActive}" data-mock="false"></div>`;
          }).join("")}
        </div>
        <div class="pib-history-footer">
          <span>${escapeHtml(String(years[0]))}</span>
          <span>${escapeHtml(String(years[years.length-1]))}</span>
        </div>
      </div>
    `;
  }

  function applyGdpHistoryStyles(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll(".pib-history-bar").forEach(bar => {
      const h = bar.dataset.h;
      const isActive = bar.dataset.active === "true";
      const isMock = bar.dataset.mock === "true";
      const isHdi = bar.dataset.kind === "hdi";
      bar.style.flex = "1";
      bar.style.height = h + "%";
      bar.style.background = isActive
        ? (isHdi ? "#a9d65c" : "var(--gold)")
        : (isMock ? "rgba(242,193,78,0.15)" : (isHdi ? "rgba(169,214,92,0.45)" : "rgba(242,193,78,0.45)"));
      bar.style.borderRadius = "2px";
      bar.style.transition = "all 0.2s";
    });
  }

  function renderSidebarCards(cards) {
    elements["analysis-cards"].innerHTML = cards.map((card) => {
      if (card.isHtml) {
        return `<div class="stat-card stat-card-plain">${card.value}</div>`;
      }
      return `
        <div class="stat-card">
          <div class="stat-label">${escapeHtml(card.label)}</div>
          <div class="stat-value">${escapeHtml(card.value)}</div>
        </div>
      `;
    }).join("");
    applyGdpHistoryStyles("gdp-history-chart");
    applyGdpHistoryStyles("hdi-history-chart");
    if (window.lucide) window.lucide.createIcons();
  }

  function renderGeneralCards(caption, cards) {
    elements["general-caption"].textContent = caption;
    elements["general-grid"].innerHTML = cards.map((card) => {
      if (card.isHtml) {
        return `<div class="grid-full-span">${card.value}</div>`;
      }
      return `
        <div>
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
        </div>
      `;
    }).join("");
    applyGdpHistoryStyles("gdp-history-chart");
    applyGdpHistoryStyles("hdi-history-chart");
    if (window.lucide) window.lucide.createIcons();
  }

  function brazilGeneralCards() {
    const politics = brazilPoliticalSummary();
    const gdpPerCapita = perCapita(brazilGdp, totalPopulation);
    const area = brazilMeshFeature ? brazilMeshFeature.properties.areaKm2 : null;
    return [
      { label: "População", value: formatNumber(totalPopulation) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? totalPopulation / area : null) },
      { label: `PIB ${brazilGdpYear || ""}`, value: formatCurrencyShort(brazilGdp) },
      { label: "PIB por habitante", value: formatCurrency(gdpPerCapita) },
      { label: "Presidente", value: NATIONAL_EXECUTIVE.president },
      { label: "Vice-presidente", value: NATIONAL_EXECUTIVE.vicePresident },
      { label: "Congresso", value: `${formatNumber(politics.federalDeputies)} dep. fed. | ${formatNumber(politics.senators)} sen.` },
      { label: "Governos estaduais", value: `${formatNumber(politics.governors)} gov. | ${formatNumber(politics.stateDeputies)} dep. est./dist.` },
      { label: "Executivos municipais", value: `${formatNumber(politics.mayors)} prefeitos | ${formatNumber(politics.viceMayors)} vices` },
      { label: "Vereadores", value: formatNumber(politics.councilorsMax) },
      { label: "Total político estim.", value: formatNumber(politics.total) }
    ];
  }

  function stateGeneralCards(state) {
    const politics = statePoliticalSummary(state);
    const gdpPerCapita = perCapita(state.gdp, state.pop);
    const brazilPerCapita = perCapita(brazilGdp, totalPopulation);
    const feature = stateFeatureById.get(state.id);
    const area = feature ? feature.properties.areaKm2 : null;
    return [
      { label: "População", value: formatNumber(state.pop || 0) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? (state.pop || 0) / area : null) },
      { label: `PIB ${state.gdpYear || brazilGdpYear || ""}`, value: formatCurrencyShort(state.gdp) },
      { label: "PIB por habitante", value: formatCurrency(gdpPerCapita) },
      { label: "Relativo ao Brasil", value: formatRatio(gdpPerCapita, brazilPerCapita) },
      { label: "Executivo estadual", value: state.id === "53" ? "1 governador | 1 vice" : "1 governador | 1 vice" },
      { label: "Congresso por UF", value: `${politics.federalDeputies} dep. fed. | 3 sen.` },
      { label: state.id === "53" ? "Deputados distritais" : "Deputados estaduais", value: formatStateDeputies(state, politics) },
      { label: "Prefeitos", value: politics.mayors ? formatNumber(politics.mayors) : "não se aplica" },
      { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
      { label: "Total político estim.", value: formatNumber(politics.total) }
    ];
  }

  function cityGeneralCards(props) {
    const state = stateById.get(String(props.stateId));
    const cityPerCapita = perCapita(props.gdp, props.pop);
    const statePerCapita = state ? perCapita(state.gdp, state.pop) : 0;
    const politics = cityPoliticalSummary(props);
    const area = props.areaKm2;
    return [
      { label: "População", value: formatNumber(props.pop || 0) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? (props.pop || 0) / area : null) },
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShortUSD(props.gdp) },
      { label: "PIB por habitante", value: formatCurrency(cityPerCapita) },
      { label: "Relativo à UF", value: formatRatio(cityPerCapita, statePerCapita) },
      { label: "Executivo municipal", value: politics.mayor ? "1 prefeito | 1 vice" : "não se aplica" },
      { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
      { label: "Total político estim.", value: politics.total ? formatNumber(politics.total) : "não se aplica" },
      { label: "UF", value: `${props.stateName || ""} (${props.uf || ""})` }
    ];
  }

  function analysisCards(scope, data) {
    if (activeAnalysis === "gdp") return gdpCards(scope, data);
    if (activeAnalysis === "hdi") return hdiCards(scope, data);
    if (activeAnalysis === "politics") return politicsCards(scope, data);
    if (activeAnalysis === "education") return educationCards(scope, data);
    if (activeAnalysis === "security") return securityCards(scope, data);
    if (activeAnalysis === "travel") return travelCards(scope, data);
    if (scope === "state") return stateGeneralCards(data);
    if (scope === "city") return cityGeneralCards(data);
    return brazilGeneralCards();
  }

  function securityCards(scope, data) {
    const metric = activeSecuritySubMetric || "mviRate";
    const metricLabels = {
      mviRate: "MVI",
      vehicleTheftRate: "Roubo de Veículos",
      femicideRate: "Feminicídio",
      domesticViolenceRate: "Violência Doméstica"
    };
    const metricLabel = metricLabels[metric] || "MVI";
    const valueForMetric = (row) => row[metric] || 0;

    if (scope === "state") {
      const cards = [
        { label: `${metricLabel} ${data.securityYear || 2023}`, value: `${valueForMetric(data).toFixed(1)} por 100k` },
        { label: `Ranking ${metricLabel}`, value: rankTextByMetric(Array.from(stateById.values()), data.id, valueForMetric, "no Brasil") },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Mapa de calor", value: `${metricLabel} por 100 mil habitantes` },
        { label: "Fonte", value: compactSourceLine(["securityBrazilFBSP"]) }
      ];
      // Show all indicators in general view
      if (metric !== "mviRate") {
        cards.splice(1, 0, { label: `MVI ${data.securityYear || 2023}`, value: `${(data.mviRate || 0).toFixed(1)} por 100k` });
      }
      return cards;
    }
    if (scope === "city") {
      const isReal = data.securityReal;
      const sourceIds = isReal ? ["securityBrazilIPEACities"] : ["securityBrazilFBSP", "securityBrazilCityProxy"];
      const cards = [
        { label: `${metricLabel} ${data.securityYear || 2023}${isReal ? "" : " (Proxy UF)"}`, value: `${valueForMetric(data).toFixed(1)} por 100k` },
        { label: "Nível do dado", value: isReal ? "IPEA Atlas municipal" : "Proxy pela UF" },
        { label: "UF", value: `${data.stateName || ""} (${data.uf || ""})` },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Fonte", value: compactSourceLine(sourceIds) }
      ];
      if (isReal && data.homicideRate) {
        cards.splice(1, 0, { label: `Homicídios IPEA ${data.securityYear || 2022}`, value: `${data.homicideRate.toFixed(1)} por 100k` });
      }
      return cards;
    }
    const brData = securityBrazilData ? securityBrazilData.brazil : {};
    return [
      { label: `${metricLabel} Brasil ${brData.year || 2023}`, value: `${(brData[metric] || 0).toFixed(1)} por 100k` },
      { label: "Mapa de calor", value: `${metricLabel} por 100 mil habitantes` },
      { label: "Fonte", value: compactSourceLine(["securityBrazilFBSP"]) }
    ];
  }

  function hdiCards(scope, data) {
    const year = resolveHdiYear(scope === "world" ? "world" : "brazil");
    if (scope === "state") {
      const entry = data.hdiComponents || hdiEntryForYear(data.hdiHistory, year);
      return [
        { label: `IDHM ${data.hdiYear || year}`, value: formatHdi(data.hdi) },
        { label: "Ranking IDHM", value: rankTextByMetric(Array.from(stateById.values()), data.id, (row) => row.hdi || 0, "no Brasil") },
        { label: "Longevidade", value: formatHdiComponent(entry, "longevity") },
        { label: "Educação", value: formatHdiComponent(entry, "education") },
        { label: "Renda", value: formatHdiComponent(entry, "income") },
        { label: "IDHMAD", value: formatHdiComponent(entry, "adjusted") },
        { label: "Fonte", value: compactSourceLine(["idhmPnudBrazil"]) },
        { label: "Histórico", value: renderHdiHistoryChart(data.hdiHistory, data.hdiYear || year), isHtml: true }
      ];
    }

    if (scope === "city") {
      const entry = data.hdiComponents || hdiEntryForYear(data.hdiHistory, year);
      return [
        { label: `IDHM ${data.hdiYear || year}`, value: `${formatHdi(data.hdi)} (proxy UF)` },
        { label: "Nível do dado", value: "UF, não cidade" },
        { label: "UF usada", value: `${data.stateName || ""} (${data.uf || ""})` },
        { label: "Longevidade UF", value: formatHdiComponent(entry, "longevity") },
        { label: "Educação UF", value: formatHdiComponent(entry, "education") },
        { label: "Renda UF", value: formatHdiComponent(entry, "income") },
        { label: "Fonte", value: compactSourceLine(["idhmPnudBrazil", "idhmCityProxy"]) },
        { label: "Histórico", value: renderHdiHistoryChart(data.hdiHistory, data.hdiYear || year, true), isHtml: true }
      ];
    }

    const entry = hdiEntryForYear(brazilHdiHistory, year);
    return [
      { label: `IDHM Brasil ${year}`, value: formatHdi(entry ? entry.idhm : 0) },
      { label: "Longevidade", value: formatHdiComponent(entry, "longevity") },
      { label: "Educação", value: formatHdiComponent(entry, "education") },
      { label: "Renda", value: formatHdiComponent(entry, "income") },
      { label: "IDHMAD", value: formatHdiComponent(entry, "adjusted") },
      { label: "Série histórica", value: `${availableBrazilHdiYears[availableBrazilHdiYears.length - 1] || "-"}-${availableBrazilHdiYears[0] || "-"}` },
      { label: "Fonte", value: compactSourceLine(["idhmPnudBrazil"]) },
      { label: "Histórico BR", value: renderHdiHistoryChart(brazilHdiHistory, year), isHtml: true }
    ];
  }

  function gdpCards(scope, data) {
    if (scope === "state") {
      const perCapitaValue = perCapita(data.gdp, data.pop);
      const cards = [
        { label: `PIB ${data.gdpYear || brazilGdpYear || ""}`, value: formatCurrencyShort(data.gdp) },
        { label: "PIB por habitante", value: formatCurrency(perCapitaValue) },
        { label: "Ranking PIB/hab.", value: rankTextByMetric(Array.from(stateById.values()), data.id, (row) => perCapita(row.gdp, row.pop), "no Brasil") },
        { label: "Participação no PIB BR", value: brazilGdp ? percent((data.gdp || 0) / brazilGdp) : "-" },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Mapa de calor", value: "PIB por habitante" }
      ];
      if (data.gdpHistory) {
        cards.push({ label: "Histórico", value: renderGdpHistoryChart(data.gdpHistory), isHtml: true });
      }
      return cards;
    }

    if (scope === "city") {
      const state = stateById.get(String(data.stateId));
      const cities = citiesForState(data.stateId);
      const perCapitaValue = perCapita(data.gdp, data.pop);
      return [
        { label: `PIB ${data.gdpYear || ""}`, value: formatCurrencyShort(data.gdp) },
        { label: "PIB por habitante", value: formatCurrency(perCapitaValue) },
        { label: "Ranking PIB/hab. na UF", value: rankTextByMetric(cities, data.id, (row) => perCapita(row.gdp, row.pop), state ? `em ${state.sigla}` : "na UF") },
        { label: "Participação no PIB da UF", value: state && state.gdp ? percent((data.gdp || 0) / state.gdp) : "-" },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Mapa de calor", value: "PIB por habitante" }
      ];
    }

    return [
      { label: `PIB ${brazilGdpYear || ""}`, value: formatCurrencyShort(brazilGdp) },
      { label: "PIB por habitante", value: formatCurrency(perCapita(brazilGdp, totalPopulation)) },
      { label: "População", value: formatNumber(totalPopulation) },
      { label: "Mapa de calor", value: "PIB por habitante" },
      { label: "Histórico BR", value: renderGdpHistoryChart(brazilGdpHistory), isHtml: true },
      { label: "Comparação", value: "Estados e cidades" },
      { label: "Fonte", value: "SIDRA/IBGE 5938" }
    ];
  }

  function politicsCards(scope, data) {
    if (scope === "state") {
      const politics = statePoliticalSummary(data);
      return [
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Total político estim.", value: formatNumber(politics.total) },
        { label: "Habitantes por político", value: formatPeoplePerPolitician(inhabitantsPerPolitician(data.pop, politics.total)) },
        { label: data.id === "53" ? "Deputados distritais" : "Deputados estaduais", value: formatStateDeputies(data, politics) },
        { label: "Congresso por UF", value: `${politics.federalDeputies} dep. fed. | 3 sen.` },
        { label: "Prefeitos", value: politics.mayors ? formatNumber(politics.mayors) : "não se aplica" },
        { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
        { label: "Folha pública", value: "fonte oficial pendente" }
      ];
    }

    if (scope === "city") {
      const politics = cityPoliticalSummary(data);
      return [
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Executivo municipal", value: politics.mayor ? "1 prefeito | 1 vice" : "não se aplica" },
        { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
        { label: "Total político estim.", value: politics.total ? formatNumber(politics.total) : "não se aplica" },
        { label: "Habitantes por político", value: formatPeoplePerPolitician(inhabitantsPerPolitician(data.pop, politics.total)) },
        { label: "Folha pública", value: "fonte oficial pendente" },
        { label: "Mapa de calor", value: "habitantes por político" }
      ];
    }

    const politics = brazilPoliticalSummary();
    return [
      { label: "População", value: formatNumber(totalPopulation) },
      { label: "Presidente", value: NATIONAL_EXECUTIVE.president },
      { label: "Congresso", value: `${formatNumber(politics.federalDeputies)} dep. fed. | ${formatNumber(politics.senators)} sen.` },
      { label: "Habitantes por político", value: formatPeoplePerPolitician(inhabitantsPerPolitician(totalPopulation, politics.total)) },
      { label: "Deputados estaduais", value: formatNumber(politics.stateDeputies) },
      { label: "Prefeitos", value: formatNumber(politics.mayors) },
      { label: "Vereadores", value: formatNumber(politics.councilorsMax) },
      { label: "Folha pública", value: "fonte oficial pendente" }
    ];
  }

  function educationCards(scope, data) {
    const scores = ENEM_HISTORY_SCORES[activeEnemYear] || {};
    if (scope === "state") {
      const sigla = (data && (data.sigla || data.uf)) || "";
      const score = scores[sigla];
      const sortedScores = Object.values(scores).sort((a, b) => b - a);
      const rank = score ? sortedScores.indexOf(score) + 1 : null;
      const diff = score && BRAZIL_ENEM_SCORE ? (score - BRAZIL_ENEM_SCORE) : null;
      return [
        { label: `Nota ENEM ${activeEnemYear}`, value: score ? `${score.toFixed(1)} pts` : "-" },
        { label: "Ranking nacional", value: rank ? `${rank}º de 27` : "-" },
        { label: `Média Brasil ${activeEnemYear}`, value: `${BRAZIL_ENEM_SCORE} pts` },
        { label: "Desempenho relativo", value: diff !== null ? (diff > 0 ? `+${diff.toFixed(1)} pts acima do BR` : `${diff.toFixed(1)} pts abaixo do BR`) : "-" },
        { label: "Mapa de calor", value: `nota média ENEM ${activeEnemYear}` },
        { label: "Fonte", value: `${compactSourceLine(["enemLocal"])} | misto` }
      ];
    }
    if (scope === "city") {
      const cityScore = data ? data.enemScore : null;
      const sigla = (data && data.uf) || "";
      const stateScore = scores[sigla];
      return [
        { label: `Nota ENEM ${activeEnemYear} (Proj.)`, value: cityScore ? `${cityScore.toFixed(1)} pts` : "-" },
        { label: `Média UF (${sigla})`, value: stateScore ? `${stateScore.toFixed(1)} pts` : "-" },
        { label: `Média Brasil ${activeEnemYear}`, value: `${BRAZIL_ENEM_SCORE} pts` },
        { label: "Dados por cidade", value: "estimativa projetada" },
        { label: "Linguagens (BR)", value: `${BRAZIL_ENEM_AREAS.linguagens} pts` },
        { label: "Matemática (BR)", value: `${BRAZIL_ENEM_AREAS.matematica} pts` }
      ];
    }
    return [
      { label: `Nota ENEM ${activeEnemYear}`, value: `${BRAZIL_ENEM_SCORE} pts` },
      { label: "Linguagens", value: `${BRAZIL_ENEM_AREAS.linguagens} pts` },
      { label: "Matemática", value: `${BRAZIL_ENEM_AREAS.matematica} pts` },
      { label: "Ciências Humanas", value: `${BRAZIL_ENEM_AREAS.humanas} pts` },
      { label: "Ciências da Natureza", value: `${BRAZIL_ENEM_AREAS.natureza} pts` },
      { label: "Redação", value: `${BRAZIL_ENEM_AREAS.redacao} pts` }
    ];
  }

  function travelCards(scope, data) {
    if (scope === "state") {
      const citiesInState = citiesForState(data.id);
      const docCount = citiesInState.filter(c => DOCUMENTED_CITIES[c.id]).length;
      return [
        { label: "Cidades documentadas", value: docCount > 0 ? formatNumber(docCount) : "Ainda não" },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Mapa de calor", value: "Estados com documentários" }
      ];
    }
    if (scope === "city") {
      const doc = DOCUMENTED_CITIES[data.id];
      const cards = [
        { label: "Documentário", value: doc ? "Disponível" : "Ainda não" },
        { label: "Cidade", value: data.name },
        { label: "Estado", value: data.uf }
      ];
      if (doc && doc.v) {
        const videoId = getYouTubeId(doc.v);
        const thumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
        const safeHref = escapeHtml(doc.v);
        cards.push({
          label: "Vídeo",
          value: `
            <div class="mt-6 w-full">
              ${thumbUrl ? `<img src="${thumbUrl}" class="video-thumb">` : ""}
              <div class="video-title">${escapeHtml(doc.t || "Documentário Especial")}</div>
              <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="video-link">Assistir vídeo <i aria-hidden="true" data-lucide="external-link" class="icon-small"></i></a>
            </div>
          `,
          isHtml: true
        });
      }
      cards.push({ label: "População", value: formatNumber(data.pop || 0) });
      return cards;
    }
    return [
      { label: "Temática", value: "História e cultura local" },
      { label: "Total de cidades mapeadas", value: Object.keys(DOCUMENTED_CITIES).length.toString() }
    ];
  }

  function analysisNote() {
    const config = activeAnalysisConfig();
    const projectionWarning = activeAnalysis === "gdp" && parseInt(activeGdpYear, 10) > parseInt(LATEST_OFFICIAL_GDP_YEAR, 10)
      ? ` Ano ${activeGdpYear} marcado como projeção local.`
      : "";
    const hdiWarning = activeAnalysis === "hdi"
      ? ` Ano ativo: ${resolveHdiYear() || "N/D"}.${activeView === "cities" ? " Em cidades, o valor é proxy por UF, não IDHM municipal real." : ""}`
      : "";
    const securityWarning = activeAnalysis === "security"
      ? ` Indicador ativo: ${activeSecuritySubMetric || "mviRate"}.${activeView === "cities" ? " Em cidades, prioriza dado IPEA Atlas; quando ausente, usa proxy UF." : ""}`
      : "";
    return `${config.note}${projectionWarning}${hdiWarning}${securityWarning} Fonte/procedência: ${sourceDetailsLine()}.`;
  }

  function renderStateChart() {
    const config = stateChartConfig();
    if (config.pending) {
      elements["chart-title"].textContent = config.title;
      elements["chart-caption"].textContent = config.caption;
      renderChartEmpty(config.empty);
      return;
    }
    const rows = Array.from(stateById.values())
      .sort((a, b) => config.value(b) - config.value(a))
      .slice(0, 10);
    elements["chart-title"].textContent = config.title;
    elements["chart-caption"].textContent = config.caption;
    renderBarChart(rows, (row) => `${row.sigla} | ${row.nome}`, elements["population-chart"], config.value, config.format);
  }

  function renderMunicipalityChart(collection) {
    const state = stateById.get(selectedStateId);
    const config = cityChartConfig(state);
    if (config.pending) {
      elements["chart-title"].textContent = config.title;
      elements["chart-caption"].textContent = config.caption;
      renderChartEmpty(config.empty);
      return;
    }
    const rows = collection.features
      .map((feature) => feature.properties)
      .sort((a, b) => config.value(b) - config.value(a))
      .slice(0, 10);
    elements["chart-title"].textContent = config.title;
    elements["chart-caption"].textContent = config.caption;
    renderBarChart(rows, (row) => row.name, elements["population-chart"], config.value, config.format);
  }

  function renderChartEmpty(message) {
    elements["population-chart"].innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function renderBarChart(rows, nameFactory, target, valueFactory = (row) => row.pop || 0, valueFormatter = formatShort) {
    const max = Math.max(...rows.map((row) => valueFactory(row) || 0), 1);
    
    // 1. Render the structure
    target.innerHTML = rows.map((row) => {
      const value = valueFactory(row) || 0;
      const width = Math.max(2, (value / max) * 100);
      return `
        <div class="bar-row">
          <div class="bar-track">
            <div class="bar-fill" data-width="${width.toFixed(2)}"></div>
            <div class="bar-name">${escapeHtml(nameFactory(row))}</div>
          </div>
          <div class="bar-value">${valueFormatter(value)}</div>
        </div>
      `;
    }).join("");

    // 2. Apply widths via DOM API (allowed by strict CSP)
    target.querySelectorAll('.bar-fill').forEach(bar => {
      const w = bar.getAttribute('data-width');
      if (w) bar.style.width = w + '%';
    });
  }

  function stateChartConfig() {
    if (activeAnalysis === "gdp") {
      return {
        title: "Estados por PIB por habitante",
        caption: "mais ricos | top 10",
        value: (row) => perCapita(row.gdp, row.pop),
        format: formatCurrencyShort
      };
    }
    if (activeAnalysis === "hdi") {
      return {
        title: `Estados por IDHM ${resolveHdiYear("brazil")}`,
        caption: "maior desenvolvimento humano | top 10",
        value: (row) => row.hdi || 0,
        format: formatHdi
      };
    }
    if (activeAnalysis === "politics") {
      return {
        title: "Estados por habitantes por político",
        caption: "maior carga por político | top 10",
        value: (row) => inhabitantsPerPolitician(row.pop, statePoliticalSummary(row).total),
        format: formatPeoplePerPoliticianShort
      };
    }
    if (activeAnalysis === "education") {
      return {
        title: `Estados por nota ENEM ${ENEM_STATES_YEAR}`,
        caption: "maiores médias | top 10",
        value: (row) => row.enemScore || 0,
        format: (v) => v ? `${v.toFixed(1)} pts` : "-"
      };
    }
    if (activeAnalysis === "travel") {
      return {
        title: "Estados com mais documentários",
        caption: "estimativa por região",
        value: (row) => ["RS", "SC", "PR"].includes(row.sigla) ? row.pop : 0,
        format: formatShort
      };
    }
    if (activeAnalysis === "security") {
      const metric = activeSecuritySubMetric || "mviRate";
      const metricTitles = {
        mviRate: "MVI",
        vehicleTheftRate: "Roubo de Veículos",
        femicideRate: "Feminicídio",
        domesticViolenceRate: "Violência Doméstica"
      };
      const title = metricTitles[metric] || "MVI";
      return {
        title: `Estados por ${title}`,
        caption: "maiores taxas | top 10",
        value: (row) => row[metric] || 0,
        format: (v) => `${v.toFixed(1)} por 100k`
      };
    }
    return {
      title: "Estados mais populosos",
      caption: "top 10",
      value: (row) => row.pop || 0,
      format: formatShort
    };
  }

  function cityChartConfig(state) {
    const uf = state ? state.sigla : "UF";
    if (activeAnalysis === "gdp") {
      return {
        title: `Cidades por PIB por habitante de ${uf}`,
        caption: "mais ricas | top 10",
        value: (row) => perCapita(row.gdp, row.pop),
        format: formatCurrencyShort
      };
    }
    if (activeAnalysis === "hdi") {
      return {
        title: `Cidades por IDHM de ${uf}`,
        caption: "proxy pela UF; não é ranking municipal real",
        value: (row) => row.hdi || 0,
        format: (v) => `${formatHdi(v)} proxy`
      };
    }
    if (activeAnalysis === "politics") {
      return {
        title: `Cidades por habitantes por político de ${uf}`,
        caption: "maior carga por político | top 10",
        value: (row) => inhabitantsPerPolitician(row.pop, cityPoliticalSummary(row).total),
        format: formatPeoplePerPoliticianShort
      };
    }
    if (activeAnalysis === "security") {
      const metric = activeSecuritySubMetric || "mviRate";
      const metricTitles = {
        mviRate: "MVI",
        vehicleTheftRate: "Roubo de Veículos",
        femicideRate: "Feminicídio",
        domesticViolenceRate: "Violência Doméstica"
      };
      const title = metricTitles[metric] || "MVI";
      return {
        title: `${title} — cidades de ${uf}`,
        caption: metric === "mviRate" ? "IPEA + proxy UF quando ausente" : "proxy pela UF",
        value: (row) => row[metric] || 0,
        format: (v) => `${v.toFixed(1)} por 100k`
      };
    }
    if (activeAnalysis === "education") {
      return {
        title: `ENEM ${ENEM_STATES_YEAR} — cidades de ${uf}`,
        caption: `maiores médias (estimativas projetadas) | top 10`,
        value: (row) => row.enemScore || 0,
        format: (v) => v ? `${v.toFixed(1)} pts` : "-"
      };
    }
    if (activeAnalysis === "travel") {
      return {
        title: `Cidades documentadas em ${uf}`,
        caption: "por população",
        value: (row) => DOCUMENTED_CITIES[row.id] ? row.pop : 0,
        format: formatShort
      };
    }
    return {
      title: `Maiores cidades de ${uf}`,
      caption: "top 10",
      value: (row) => row.pop || 0,
      format: formatShort
    };
  }

  function renderMunicipalityRanking(collection) {
    const state = stateById.get(selectedStateId);
    const uf = state ? state.sigla : "UF";
    const config = cityChartConfig(state);
    if (config.pending) {
      elements["ranking-title"].textContent = config.title;
      elements["ranking-caption"].textContent = "fonte pendente";
      elements.ranking.innerHTML = `<div class="empty">${escapeHtml(config.empty)}</div>`;
      return;
    }
    const rows = collection.features
      .map((feature) => feature.properties)
      .sort((a, b) => config.value(b) - config.value(a))
      .slice(0, 14);
    elements["ranking-title"].textContent = activeAnalysis === "general" ? `Cidades de ${uf}` : config.title;
    elements["ranking-caption"].textContent = `${collection.features.length} cidades`;
    elements.ranking.innerHTML = rows.map((row, index) => `
      <button type="button" class="rank-btn" data-city-id="${row.id}">
        <span class="rank-no">${String(index + 1).padStart(2, "0")}</span>
        <span class="rank-main">
          <span class="rank-name">${escapeHtml(row.name)}</span>
          <span class="rank-meta">${escapeHtml(row.uf)} | cidade</span>
        </span>
        <span class="rank-pop">${escapeHtml(config.format(config.value(row) || 0))}</span>
      </button>
    `).join("");

    elements.ranking.querySelectorAll(".rank-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const feature = collection.features.find((item) => item.properties.id === button.dataset.cityId);
        if (feature) {
          selectCity(button.dataset.cityId, feature);
          showMunicipalityPopup(null, feature.properties);
        }
      });
    });
    updateRankingActive();
  }

  function renderEmptyRanking(message) {
    elements["ranking-title"].textContent = "Cidades em foco";
    elements["ranking-caption"].textContent = "selecione uma UF";
    const text = message || "Clique em um estado no mapa ou use a busca para carregar as cidades da UF.";
    elements.ranking.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
  }

  function updateRankingActive() {
    elements.ranking.querySelectorAll(".rank-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.cityId === selectedCityId);
    });
  }

  function showPopup(lngLat, kind, title, pop, meta, extraRows) {
    showFixedDetailCard(kind, title, [
      { label: meta, value: formatNumber(pop || 0) },
      ...(extraRows || [])
    ]);
  }

  function showBrazilPopup(lngLat) {
    showFixedDetailCard("País", "Brasil", brazilPopupRows());
  }

  function showBrazilHover(lngLat) {
    if (!hoverCardsEnabled) return;
    const key = "country:BR";
    const html = popupHtml("País", "Brasil", brazilPopupRows());

    if (!hoverPopup) {
      hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "hover-popup"
      }).setLngLat(lngLat).setHTML(html).addTo(map);
      hoveredFeatureKey = key;
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
    }
  }

  function showStatePopup(lngLat, props) {
    showFixedDetailCard("Unidade da Federação", `${props.name} (${props.uf})`, statePopupRows(props), stateById.get(String(props.id)));
  }

  function showStateHover(lngLat, props) {
    if (isStreetMode || !hoverCardsEnabled) return;
    const key = `state:${props.id || ""}`;
    const html = popupHtml("Unidade da Federação", `${props.name} (${props.uf})`, statePopupRows(props));

    if (!hoverPopup) {
      hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "hover-popup"
      }).setLngLat(lngLat).setHTML(html).addTo(map);
      hoveredFeatureKey = key;
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
    }
  }

  function showMunicipalityPopup(lngLat, props) {
    const rows = municipalityPopupRows(props);
    showFixedDetailCard("Cidade", props.name, rows, props);
    if (window.lucide) window.lucide.createIcons();
  }

  function showMunicipalityHover(lngLat, props) {
    if (isStreetMode || !hoverCardsEnabled) return;
    const key = `${props.stateId || ""}:${props.id || ""}`;
    const html = popupHtml("Cidade", props.name, municipalityPopupRows(props));

    if (!hoverPopup) {
      hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "hover-popup"
      }).setLngLat(lngLat).setHTML(html).addTo(map);
      hoveredFeatureKey = key;
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function clearHoverPopup() {
    if (hoverPopup) hoverPopup.remove();
    hoverPopup = null;
    hoveredFeatureKey = null;
  }

  function brazilPopupRows() {
    if (activeAnalysis === "gdp") return gdpCards("brazil");
    if (activeAnalysis === "hdi") return hdiCards("brazil");
    if (activeAnalysis === "politics") return politicsCards("brazil");
    if (activeAnalysis === "education") return educationCards("brazil");
    if (activeAnalysis === "security") return securityCards("brazil");
    if (activeAnalysis === "travel") return travelCards("brazil");
    const politics = brazilPoliticalSummary();
    const gdpPerCapita = perCapita(brazilGdp, totalPopulation);
    const area = brazilMeshFeature ? brazilMeshFeature.properties.areaKm2 : null;
    return [
      { label: "População total", value: formatNumber(totalPopulation) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? totalPopulation / area : null) },
      { label: `PIB ${brazilGdpYear || ""}`, value: formatCurrencyShort(brazilGdp) },
      { label: "PIB por habitante", value: formatCurrency(gdpPerCapita) },
      { label: "Congresso", value: `${formatNumber(politics.federalDeputies)} dep. fed. | ${formatNumber(politics.senators)} sen.` },
      { label: "Governos estaduais", value: `${formatNumber(politics.governors)} gov. | ${formatNumber(politics.stateDeputies)} dep. est./dist.` },
      { label: "Executivos municipais", value: `${formatNumber(politics.mayors)} prefeitos | ${formatNumber(politics.viceMayors)} vices` },
      { label: "Vereadores", value: formatNumber(politics.councilorsMax) },
      { label: "Políticos estimados", value: formatNumber(politics.total) }
    ];
  }

  function statePopupRows(props) {
    const stateForCards = stateById.get(String(props.id || "")) || { id: String(props.id || ""), sigla: props.uf || "", nome: props.name || "", pop: props.pop || 0, gdp: props.gdp || 0, gdpYear: props.gdpYear || "" };
    if (activeAnalysis === "gdp") return gdpCards("state", stateForCards);
    if (activeAnalysis === "hdi") return hdiCards("state", stateForCards);
    if (activeAnalysis === "politics") return politicsCards("state", stateForCards);
    if (activeAnalysis === "education") return educationCards("state", stateForCards);
    if (activeAnalysis === "security") return securityCards("state", stateForCards);
    if (activeAnalysis === "travel") return travelCards("state", stateForCards);
    const pop = Number(props.pop || 0);
    const gdpPerCapita = perCapita(props.gdp, pop);
    const state = stateById.get(String(props.id || "")) || { id: String(props.id || ""), sigla: props.uf || "" };
    const politics = statePoliticalSummary(state);
    const feature = stateFeatureById.get(state.id);
    const area = feature ? feature.properties.areaKm2 : null;
    return [
      { label: "População total", value: formatNumber(pop) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? pop / area : null) },
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShortUSD(props.gdp) },
      { label: "PIB por habitante", value: formatCurrency(gdpPerCapita) },
      { label: state.id === "53" ? "Deputados distritais" : "Deputados estaduais", value: formatStateDeputies(state, politics) },
      { label: "Prefeitos", value: politics.mayors ? formatNumber(politics.mayors) : "não se aplica" },
      { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
      { label: "Participação no Brasil", value: totalPopulation ? percent(pop / totalPopulation) : "-" },
      { label: "Ranking nacional", value: rankText(Array.from(stateById.values()), props.id) },
      { label: "Região", value: props.region || "-" }
    ];
  }

  function municipalityPopupRows(props) {
    if (activeAnalysis === "gdp") return gdpCards("city", props);
    if (activeAnalysis === "hdi") return hdiCards("city", props);
    if (activeAnalysis === "politics") return politicsCards("city", props);
    if (activeAnalysis === "education") return educationCards("city", props);
    if (activeAnalysis === "security") return securityCards("city", props);
    if (activeAnalysis === "travel") return travelCards("city", props);
    const pop = Number(props.pop || 0);
    const state = stateById.get(String(props.stateId || ""));
    const gdpPerCapita = perCapita(props.gdp, pop);
    const politics = cityPoliticalSummary(props);
    const area = props.areaKm2;
    return [
      { label: "População", value: formatNumber(pop) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? pop / area : null) },
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShortUSD(props.gdp) },
      { label: "PIB por habitante", value: formatCurrency(gdpPerCapita) },
      { label: "Vereadores", value: politics.councilorsMax ? formatNumber(politics.councilorsMax) : "não se aplica" },
      { label: `${props.uf || "UF"} | ranking`, value: props.rank ? `${props.rank}º` : "-" },
      { label: "Participação na UF", value: state && state.pop ? percent(pop / state.pop) : "-" }
    ];
  }

  function showFixedDetailCard(kind, title, rows, context = null) {
    currentFixedCard = { kind, title, context };
    const card = elements["fixed-detail-card"];
    if (!card) return;
    card.innerHTML = `
      <button type="button" class="fixed-detail-close" aria-label="Fechar detalhes">×</button>
      ${popupHtml(kind, title, rows)}
    `;
    card.classList.add("visible");
    card.querySelector(".fixed-detail-close").addEventListener("click", hideFixedDetailCard);
    fixedPopup = { remove: hideFixedDetailCard };

    applyGdpHistoryStyles("gdp-history-chart");
    applyGdpHistoryStyles("hdi-history-chart");

    if (window.lucide) window.lucide.createIcons();
    if (map && window.innerWidth > 1040) {
      map.easeTo({ padding: { left: 360, right: 0, top: 0, bottom: 0 }, duration: 600 });
    }
  }

  function refreshFixedDetailCard() {
    if (!currentFixedCard) return;
    const { kind, context } = currentFixedCard;
    if (kind === "Unidade da Federação" && context) {
      showStatePopup(null, stateMapProperties(context));
    } else if (kind === "Cidade" && context) {
      // Re-hydrate city props for current year before refreshing popup
      const city = cityById.get(String(context.id));
      if (city) {
        const year = activeGdpYear === "last" ? (availableGdpYears[0] || "") : activeGdpYear;
        if (city.gdpHistory && city.gdpHistory[year]) {
          context.gdp = city.gdpHistory[year];
          context.gdpYear = year;
        }
        const updatedProps = { ...context, ...cityMapProperties(context) };
        showMunicipalityPopup(null, updatedProps);
      }
    } else if (kind === "País") {
      if (context && context.ISO_A3) {
        showCountryPopup(null, context);
      } else {
        showBrazilPopup(null);
      }
    }
  }

  function hideFixedDetailCard() {
    const card = elements["fixed-detail-card"];
    if (card) {
      card.classList.remove("visible");
      card.innerHTML = "";
    }
    fixedPopup = null;
    currentFixedCard = null;
    if (map && window.innerWidth > 1040) {
      map.easeTo({ padding: { left: 0, right: 0, top: 0, bottom: 0 }, duration: 600 });
    }
  }

  function popupHtml(kind, title, rows) {
    return `
      <div class="popup">
        <div class="popup-kind">${escapeHtml(kind)}</div>
        <div class="popup-title">${escapeHtml(title)}</div>
        ${rows.map((row) => {
          if (row.isHtml) {
            return `<div class="mt-10 border-top-line w-full">${row.value}</div>`;
          }
          return `<div class="popup-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`;
        }).join("")}
      </div>
    `;
  }

  function brazilPoliticalSummary() {
    const stateRows = Array.from(stateById.values());
    const mayors = municipalCityCount();
    const viceMayors = mayors;
    const councilorsMax = municipalCouncilorsMaxTotal();
    const stateDeputies = stateRows.reduce((sum, state) => sum + stateDeputyCount(state.sigla), 0);
    const total = 1 + 1 + 27 + 27 + 81 + 513 + stateDeputies + mayors + viceMayors + councilorsMax;
    return {
      federalDeputies: 513,
      senators: 81,
      governors: 27,
      stateDeputies,
      mayors,
      viceMayors,
      councilorsMax,
      total
    };
  }

  function statePoliticalSummary(state) {
    const federalDeputies = FEDERAL_DEPUTIES_BY_UF[state.sigla] || 0;
    const stateDeputies = stateDeputyCount(state.sigla);
    const cities = citiesForState(state.id);
    const hasMunicipalElection = state.id !== "53";
    const mayors = hasMunicipalElection ? cities.length : 0;
    const viceMayors = mayors;
    const councilorsMax = hasMunicipalElection
      ? cities.reduce((sum, city) => sum + councilorMaxByPopulation(city.pop || 0), 0)
      : 0;
    const total = 1 + 1 + 3 + federalDeputies + stateDeputies + mayors + viceMayors + councilorsMax;
    return { federalDeputies, stateDeputies, mayors, viceMayors, councilorsMax, total };
  }

  function formatStateDeputies(state, politics) {
    const suffix = state.id === "53" ? "dep. distritais" : "dep. estaduais";
    return `${formatNumber(politics.stateDeputies)} ${suffix}`;
  }

  function cityPoliticalSummary(props) {
    if (String(props.stateId) === "53") {
      return { mayor: 0, viceMayor: 0, councilorsMax: 0, total: 0 };
    }
    const councilorsMax = councilorMaxByPopulation(props.pop || 0);
    return { mayor: 1, viceMayor: 1, councilorsMax, total: 2 + councilorsMax };
  }

  function citiesForState(stateId) {
    return Array.from(cityById.values()).filter((city) => String(city.stateId) === String(stateId));
  }

  function municipalCityCount() {
    return Array.from(cityById.values()).filter((city) => String(city.stateId) !== "53").length;
  }

  function municipalCouncilorsMaxTotal() {
    return Array.from(cityById.values())
      .filter((city) => String(city.stateId) !== "53")
      .reduce((sum, city) => sum + councilorMaxByPopulation(city.pop || 0), 0);
  }

  function stateDeputyCount(uf) {
    const federal = FEDERAL_DEPUTIES_BY_UF[uf] || 0;
    if (!federal) return 0;
    return federal <= 12 ? federal * 3 : 36 + (federal - 12);
  }

  function councilorMaxByPopulation(population) {
    const pop = Number(population || 0);
    const bands = [
      [15000, 9], [30000, 11], [50000, 13], [80000, 15],
      [120000, 17], [160000, 19], [300000, 21], [450000, 23],
      [600000, 25], [750000, 27], [900000, 29], [1050000, 31],
      [1200000, 33], [1350000, 35], [1500000, 37], [1800000, 39],
      [2400000, 41], [3000000, 43], [4000000, 45], [5000000, 47],
      [6000000, 49], [7000000, 51], [8000000, 53]
    ];
    const band = bands.find(([limit]) => pop <= limit);
    return band ? band[1] : 55;
  }

  function fitBrazil() {
    map.fitBounds(BR_BOUNDS, { padding: { top: 64, right: 64, bottom: 52, left: 64 }, duration: 1200, essential: true });
  }

  function flyToState(state, zoom) {
    if (!state) return;
    map.flyTo({ center: [state.lng, state.lat], zoom: zoom || 5.2, pitch: 0, speed: 0.8, curve: 1.3, essential: true });
  }

  function flyToStreet(options = {}) {
    isStreetMode = true;
    setHybridBaseActive();
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    hideAtlasLayersForStreet();
    restoreBaseLabels();
    elements["hud-layer"].textContent = "Rua";
    updateHeatLegend();

    let target = selectedCityFeature && selectedCityFeature.properties;
    if (!target && selectedStateId && stateCitiesCache.has(selectedStateId)) {
      const largestCity = stateCitiesCache.get(selectedStateId).features[0];
      if (largestCity) {
        selectCity(largestCity.properties.id, largestCity, { fly: false });
        target = largestCity.properties;
      }
    }

    if (options.preserveCamera) {
      savePreferences();
      return;
    }

    const center = target ? [target.lng, target.lat] : BRASILIA_STREET_CENTER;
    map.flyTo({
      center,
      zoom: 16.1,
      pitch: 28,
      bearing: 0,
      speed: 0.65,
      curve: 1.15,
      essential: true
    });
  }

  function setHybridBaseActive() {
    const hybridButton = document.querySelector('[data-base="hybrid"]');
    if (hybridButton) setActiveButton("[data-base]", hybridButton);
    setBaseMode("hybrid");
  }

  function updateHud() {
    if (!map) return;
    const center = map.getCenter();
    elements["hud-zoom"].textContent = map.getZoom().toFixed(1);
    elements["hud-coords"].textContent = `${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}`;
  }

  function showStatus(title, text, finalState) {
    elements.status.classList.add("visible");
    elements["status-title"].textContent = title;
    elements["status-text"].textContent = text;
    elements["status-spinner"].style.display = finalState ? "none" : "inline-block";
  }

  function hideStatus() {
    elements.status.classList.remove("visible");
  }

  function applyPreferenceControls() {
    const baseButton = document.querySelector(`[data-base="${activeBaseMode}"]`);
    if (baseButton) setActiveButton("[data-base]", baseButton);

    const projectionButton = document.querySelector(`[data-projection="${activeProjection}"]`);
    if (projectionButton) setActiveButton("[data-projection]", projectionButton);

    const analysisButton = document.querySelector(`[data-analysis="${activeAnalysis}"]`);
    if (analysisButton) setActiveButton("[data-analysis]", analysisButton);
    if (elements["analysis-caption"]) elements["analysis-caption"].textContent = analysisLabel(activeAnalysis);

    setHoverCardsEnabled(hoverCardsEnabled);
    updateHeatLegend();
  }

  function setHoverCardsEnabled(enabled) {
    hoverCardsEnabled = Boolean(enabled);
    if (!hoverCardsEnabled) clearHoverPopup();

    const button = elements["hover-cards-toggle"];
    if (!button) return;
    button.classList.toggle("active", hoverCardsEnabled);
    button.setAttribute("aria-pressed", String(hoverCardsEnabled));
    button.title = hoverCardsEnabled
      ? "Desligar cards ao passar o mouse"
      : "Ligar cards ao passar o mouse";
  }

  function savePreferences() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        hoverCards: hoverCardsEnabled,
        base: activeBaseMode,
        projection: activeProjection,
        analysis: activeAnalysis,
        gdpSubMetric: activeGdpSubMetric,
        hdiYear: activeHdiYear,
        securitySubMetric: activeSecuritySubMetric,
        sourceSelections: activeSourceSelections,
        worldMetric: activeWorldMetric,
        view: activeView,
        selectedStateId,
        selectedCityId,
        camera: currentMapCamera()
      }));
    } catch (error) {}
  }

  function currentMapCamera() {
    if (!map) return savedCamera;
    const center = map.getCenter();
    return {
      center: [roundCameraValue(center.lng), roundCameraValue(center.lat)],
      zoom: roundCameraValue(map.getZoom()),
      pitch: roundCameraValue(map.getPitch()),
      bearing: roundCameraValue(map.getBearing())
    };
  }

  function restoreMapCamera(camera) {
    if (!map || !camera) return;
    map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing
    });
    updateHud();
  }

  function readStoredPreferences() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};

      const safe = {};
      if (typeof parsed.hoverCards === "boolean") safe.hoverCards = parsed.hoverCards;
      if (validBaseMode(parsed.base)) safe.base = parsed.base;
      if (validProjection(parsed.projection)) safe.projection = parsed.projection;
      if (validAnalysis(parsed.analysis)) safe.analysis = parsed.analysis;
      if (validView(parsed.view)) safe.view = parsed.view;
      if (validWorldMetric(parsed.worldMetric)) safe.worldMetric = parsed.worldMetric;

      if (parsed.selectedStateId) safe.selectedStateId = normalizeCode(parsed.selectedStateId);
      if (parsed.selectedCityId) safe.selectedCityId = normalizeCode(parsed.selectedCityId);
      if (validAnalysisMetric("gdp", parsed.gdpSubMetric)) safe.gdpSubMetric = String(parsed.gdpSubMetric);
      if (parsed.hdiYear) safe.hdiYear = String(parsed.hdiYear);
      if (validAnalysisMetric("security", parsed.securitySubMetric)) safe.securitySubMetric = String(parsed.securitySubMetric);
      if (parsed.sourceSelections && typeof parsed.sourceSelections === "object") {
        safe.sourceSelections = {};
        Object.entries(parsed.sourceSelections).forEach(([analysis, value]) => {
          if (validAnalysis(analysis)) safe.sourceSelections[analysis] = String(value);
        });
      }

      safe.camera = normalizeCamera(parsed.camera);
      return safe;
    } catch (error) {
      return {};
    }
  }

  function normalizeCamera(camera) {
    if (!camera || !Array.isArray(camera.center) || camera.center.length !== 2) return null;
    const lng = Number(camera.center[0]);
    const lat = Number(camera.center[1]);
    const zoom = Number(camera.zoom);
    if (![lng, lat, zoom].every(Number.isFinite)) return null;
    return {
      center: [lng, lat],
      zoom: clampNumber(zoom, 0, 19, 1.7),
      pitch: clampNumber(Number(camera.pitch), 0, 85, 0),
      bearing: clampNumber(Number(camera.bearing), -180, 180, 0)
    };
  }

  function validBaseMode(mode) {
    return ["map", "earth", "hybrid"].includes(mode);
  }

  function validProjection(projection) {
    return ["globe", "mercator"].includes(projection);
  }

  function validView(view) {
    return ["world", "brazil", "states", "cities", "street"].includes(view);
  }

  function validAnalysis(analysis) {
    return Object.prototype.hasOwnProperty.call(ANALYSIS_CATALOG, analysis);
  }

  function validAnalysisMetric(analysis, metric) {
    const config = ANALYSIS_CATALOG[analysis];
    return Boolean(config && config.metrics && Object.prototype.hasOwnProperty.call(config.metrics, metric));
  }

  function validWorldMetric(metric) {
    return Object.prototype.hasOwnProperty.call(WORLD_METRIC_CATALOG, metric);
  }

  function analysisLabel(analysis) {
    const config = ANALYSIS_CATALOG[analysis] || ANALYSIS_CATALOG.general;
    return config.caption || config.label;
  }

  function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function roundCameraValue(value) {
    return Number(Number(value || 0).toFixed(5));
  }

  function setActiveButton(selector, activeButton) {
    document.querySelectorAll(selector).forEach((button) => button.classList.toggle("active", button === activeButton));
  }

  function setSourceData(sourceId, data) {
    const source = map && map.getSource(sourceId);
    if (source) source.setData(data);
  }

  function updateSelectedCitySource(feature) {
    if (!feature || !feature.geometry) {
      setSourceData("selected-city-source", emptyFeatureCollection());
      return;
    }
    setSourceData("selected-city-source", { type: "FeatureCollection", features: [feature] });
    // Force-apply paint so stale layer styles from previous sessions don't persist
    forceCityHighlightPaint();
  }

  function forceCityHighlightPaint() {
    setLayerPaint("selected-city-fill", { "fill-color": "#ffffff", "fill-opacity": 0.15 });
    setLayerPaint("selected-city-glow-outer", {
      "line-color": "#51d1c2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 8],
      "line-opacity": 1,
      "line-blur": 0
    });
    setLayerPaint("selected-city-outline-inner", {
      "line-color": "#f2c14e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 4],
      "line-opacity": 1,
      "line-blur": 0
    });
    // Remove stale layers from old sessions if they exist
    ["selected-city-glow", "selected-city-outline"].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch(e) {}
    });
  }

  function clearSelectedCitySource() {
    setSourceData("selected-city-source", emptyFeatureCollection());
  }

  function addLayerOnce(layer, beforeId) {
    const validBeforeId = beforeId && map.getLayer(beforeId) && beforeId !== layer.id ? beforeId : undefined;
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer, validBeforeId);
      return;
    }
    if (validBeforeId) {
      try { map.moveLayer(layer.id, validBeforeId); } catch (error) {}
    }
  }

  function firstLineOrSymbolLayerId() {
    const layer = (map.getStyle().layers || []).find((item) => item.type === "line" || item.type === "symbol");
    return layer ? layer.id : undefined;
  }

  function firstBaseSymbolLayerId() {
    const layer = (map.getStyle().layers || []).find((item) => item.type === "symbol" && !isAtlasLayer(item.id));
    return layer ? layer.id : undefined;
  }

  async function fetchJson(url) {
    const cached = await readCachedJson(url);
    if (cached) return cached;

    const response = await fetch(url, { headers: { Accept: "application/json, application/vnd.geo+json" } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    dataCacheStats.network += 1;
    const data = await response.clone().json();
    await writeCachedResponse(url, response);
    return data;
  }

  async function readCachedJson(url) {
    if (!window.caches) {
      dataCacheStats.disabled = true;
      return null;
    }

    try {
      const cache = await window.caches.open(DATA_CACHE_NAME);
      const response = await cache.match(url);
      if (!response) return null;
      dataCacheStats.hits += 1;
      return await response.json();
    } catch (error) {
      dataCacheStats.failures += 1;
      return null;
    }
  }

  async function writeCachedResponse(url, response) {
    if (!window.caches) return;

    try {
      const cache = await window.caches.open(DATA_CACHE_NAME);
      await cache.put(url, response.clone());
      dataCacheStats.writes += 1;
    } catch (error) {
      dataCacheStats.failures += 1;
    }
  }

  function createDataCacheStats() {
    return { hits: 0, network: 0, writes: 0, failures: 0, disabled: false };
  }

  function dataCacheLabel() {
    if (dataCacheStats.hits && !dataCacheStats.network) return "cache local";
    if (dataCacheStats.hits && dataCacheStats.network) return "cache + rede";
    if (dataCacheStats.disabled) return "sem cache";
    return "dados carregados";
  }

  function parseSidraRows(data) {
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.slice(1);
  }

  function normalizeFeatureCollection(data) {
    if (!data) return emptyFeatureCollection();
    if (data.type === "FeatureCollection") return data;
    if (data.type === "Feature") return { type: "FeatureCollection", features: [data] };
    if (Array.isArray(data.features)) return { type: "FeatureCollection", features: data.features };
    return emptyFeatureCollection();
  }

  function emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  function pointFeature(coordinates, properties) {
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: { ...properties }
    };
  }

  function representativePoint(geometry) {
    const coords = flattenCoordinates(geometry);
    if (!coords.length) return null;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    coords.forEach(([lng, lat]) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
    if (!Number.isFinite(minLng)) return null;
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }

  function flattenCoordinates(geometry) {
    if (!geometry || !geometry.coordinates) return [];
    const out = [];
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number" && typeof value[1] === "number") {
        out.push(value);
      } else {
        value.forEach(walk);
      }
    };
    walk(geometry.coordinates);
    return out;
  }

  function readGeoProperty(properties, names) {
    for (const name of names) {
      if (properties && properties[name] !== undefined && properties[name] !== null) return properties[name];
    }
    return "";
  }

  function normalizeCode(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function parseNumber(value) {
    if (typeof value === "number") return value;
    const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function sumPopulation(rows) {
    return rows.reduce((sum, row) => sum + (Number(row.pop) || 0), 0);
  }

  function formatArea(km2) {
    if (!km2) return "N/D";
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(km2) + " km²";
  }

  function formatDensity(density) {
    if (!density) return "N/D";
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(density) + " hab/km²";
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("pt-BR");
  }

  function formatCurrency(value) {
    const number = Number(value || 0);
    if (!number) return "-";
    return number.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0
    });
  }

  function formatCurrencyShort(value) {
    const number = Number(value || 0);
    if (!number) return "-";
    const abs = Math.abs(number);
    if (abs >= 1000000000000) return `R$ ${(number / 1000000000000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tri`;
    if (abs >= 1000000000) return `R$ ${(number / 1000000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
    if (abs >= 1000000) return `R$ ${(number / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    return formatCurrency(number);
  }


  function formatCurrencyUSD(value) {
    const number = Number(value || 0);
    if (!number) return "-";
    return number.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });
  }

  function formatCurrencyShortUSD(value) {
    const number = Number(value || 0);
    if (!number) return "-";
    const abs = Math.abs(number);
    if (abs >= 1000000000000) return `US$ ${(number / 1000000000000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tri`;
    if (abs >= 1000000000) return `US$ ${(number / 1000000000).toLocaleString("en-US", { maximumFractionDigits: 1 })} bi`;
    if (abs >= 1000000) return `US$ ${(number / 1000000).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`;
    return formatCurrencyUSD(number);
  }

  function perCapita(total, population) {
    const value = Number(total || 0);
    const pop = Number(population || 0);
    return value && pop ? value / pop : 0;
  }

  function inhabitantsPerPolitician(population, politicians) {
    const pop = Number(population || 0);
    const total = Number(politicians || 0);
    return pop && total ? pop / total : 0;
  }

  function formatRatio(value, base) {
    const ratio = Number(base || 0) ? Number(value || 0) / Number(base || 0) : 0;
    if (!ratio) return "-";
    return `${ratio.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
  }

  function formatShort(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${(number / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (number >= 1000) return `${(number / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
    return formatNumber(number);
  }

  function formatHdi(value) {
    const number = Number(value || 0);
    return number ? number.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "-";
  }

  function formatHdiComponent(entry, key) {
    if (!entry) return "-";
    return formatHdi(entry[key]);
  }

  function hdiCountryCount() {
    const dataset = activeGlobalHdiDataset();
    return dataset && dataset.countries ? Object.keys(dataset.countries).length : "-";
  }

  function hdiCategoryLabel(category) {
    const map = {
      "Low": "baixo",
      "Medium": "médio",
      "High": "alto",
      "Very High": "muito alto"
    };
    return map[category] || category || "-";
  }

  function formatPeoplePerPolitician(value) {
    const number = Number(value || 0);
    return number ? `${formatShort(Math.round(number))} hab./político` : "não se aplica";
  }

  function formatPeoplePerPoliticianShort(value) {
    const number = Number(value || 0);
    return number ? `${formatShort(Math.round(number))}/pol.` : "-";
  }

  function percent(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function rankText(rows, id) {
    const sorted = rows.slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
    const index = sorted.findIndex((row) => row.id === String(id));
    return index >= 0 ? `${index + 1}º no Brasil` : "-";
  }

  function rankTextByMetric(rows, id, valueFactory, suffix) {
    const sorted = rows
      .filter((row) => Number(valueFactory(row) || 0) > 0)
      .sort((a, b) => valueFactory(b) - valueFactory(a));
    const index = sorted.findIndex((row) => String(row.id) === String(id));
    return index >= 0 ? `${index + 1}º ${suffix}` : "-";
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function calculateArea(feature) {
    if (!feature || !feature.geometry) return 0;
    const geom = feature.geometry;
    let area = 0;
    if (geom.type === "Polygon") {
      area = polygonArea(geom.coordinates);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        area += polygonArea(poly);
      }
    }
    return area;
  }

  function polygonArea(coords) {
    let area = 0;
    if (coords && coords.length > 0) {
      area += Math.abs(ringArea(coords[0]));
      for (let i = 1; i < coords.length; i++) {
        area -= Math.abs(ringArea(coords[i]));
      }
    }
    return area;
  }

  function ringArea(coords) {
    let area = 0;
    const WGS84_RADIUS = 6378137;
    if (coords.length > 2) {
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        area += (rad(p2[0]) - rad(p1[0])) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])));
      }
      area = (area * WGS84_RADIUS * WGS84_RADIUS) / 2;
    }
    return area;
  }

  function rad(deg) {
    return (deg * Math.PI) / 180;
  }

  function getYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  function renderSelectedWorld() {
    const worldHdiSourceIds = activeDataSourceIds();
    const globalHdiDataset = activeGlobalHdiDataset();
    const globalHdiYears = hdiYearsForActiveView("world");
    const securityWorldSourceIds = activeAnalysis === "security" ? activeDataSourceIds() : ["securityGlobalUnodc"];
    updateSourceDisplays(activeAnalysis === "hdi" ? worldHdiSourceIds : (activeAnalysis === "security" ? securityWorldSourceIds : ["localWorldJson"]));
    const hdiYear = resolveHdiYear("world");
    const globalHdiCount = globalHdiDataset && globalHdiDataset.countries ? Object.keys(globalHdiDataset.countries).length : 0;
    const globalSecurityCount = securityGlobalData && securityGlobalData.countries ? Object.keys(securityGlobalData.countries).length : 0;
    elements["selected-code"].textContent = "GLOBO";
    elements["selected-type"].textContent = "Mundo";
    elements["selected-name"].textContent = "Visão Global";
    elements["selected-pop"].textContent = "8 Bi+";
    elements["selected-share"].textContent = "100%";
    elements["selected-area"].textContent = "148 mi km²";
    elements["selected-density"].textContent = "54 hab/km²";
    elements["selected-rank"].textContent = "-";
    elements["selected-context"].textContent = "Planeta Terra";
    renderGeneralCards("Mundo", [
        { label: "Países", value: "~195" },
        { label: "População estimada", value: "8 bilhões" },
        ...(activeAnalysis === "hdi" ? [
          { label: `IDH ${hdiYear}`, value: globalHdiCount ? `${formatNumber(globalHdiCount)} países na base` : "carregando" },
          { label: "Série histórica", value: `${globalHdiYears[globalHdiYears.length - 1] || "-"}-${globalHdiYears[0] || "-"}` },
          { label: "Fonte selecionada", value: activeSourceOption("hdi", "world")?.label || "UNDP/HDR" }
        ] : []),
        ...(activeAnalysis === "security" ? (() => {
          const sourceId = activeSourceOptionId("security", "world");
          if (sourceId === "gpi") {
            return [
              { label: "GPI", value: globalSecurityCount ? `${formatNumber(globalSecurityCount)} países na base` : "carregando" },
              { label: "Fonte", value: "Vision of Humanity" }
            ];
          }
          return [
            { label: "Homicídios", value: globalSecurityCount ? `${formatNumber(globalSecurityCount)} países na base` : "carregando" },
            { label: "Fonte", value: "UNODC" }
          ];
        })() : []),
        { label: "Arquivo local", value: activeAnalysis === "hdi" ? (activeSourceOptionId("hdi", "world") === "owid" ? "data/hdi_owid.json" : "data/hdi_global.json") : (activeAnalysis === "security" ? "data/security_global.json" : "data/world_data.geojson") },
        { label: "Origem original", value: activeAnalysis === "hdi" ? upstreamSourceLine(sourceRecords(worldHdiSourceIds)[0]) : (activeAnalysis === "security" ? upstreamSourceLine(DATA_SOURCE_CATALOG.securityGlobalUnodc) : upstreamSourceLine(DATA_SOURCE_CATALOG.localWorldJson)) }
    ]);
    elements["general-note"].textContent = activeAnalysis === "hdi"
      ? `IDH global carregado de JSON local auditável. Fonte/procedência: ${sourceDetailsLine(worldHdiSourceIds)}.`
      : (activeAnalysis === "security"
        ? `Dados de segurança global carregados de JSON local. Fonte/procedência: ${sourceDetailsLine(["securityGlobalUnodc"])}.`
        : `Dados globais carregados de base JSON local. Fonte/procedência: ${sourceDetailsLine(["localWorldJson"])}.`);
  }

  async function enterWorldMode(options = {}) {
    isStreetMode = false;
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    selectedStateId = null;
    selectedCityId = null;
    
    if (!map.getSource("world-fill-source")) {
        showStatus("Carregando mapa-múndi", "Buscando dados globais...");
        try {
            const data = await fetchJson(URLS.worldMesh);
            worldFeatureCollection = data;
            hydrateWorldHdi(worldFeatureCollection);
            hydrateWorldSecurity(worldFeatureCollection);
            
            map.addSource("world-fill-source", { type: "geojson", data: worldFeatureCollection });
            map.addSource("selected-country-source", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            
            const baseSymbolLayerId = firstBaseSymbolLayerId();
            addLayerOnce({
              id: "world-fill",
              type: "fill",
              source: "world-fill-source",
              layout: { visibility: "visible" },
              paint: {
                "fill-color": [
                  "interpolate", ["linear"], ["to-number", ["get", "pop"], 0],
                  0, "#17212b",
                  1000000, "#25534e",
                  10000000, "#5b8e54",
                  50000000, "#c59b3f",
                  200000000, "#ef7d60",
                  1000000000, "#b799ff"
                ],
                "fill-opacity": 0.58
              }
            }, baseSymbolLayerId);
            addLayerOnce({
              id: "world-outline",
              type: "line",
              source: "world-fill-source",
              layout: { visibility: "visible" },
              paint: {
                "line-color": "rgba(237, 243, 238, 0.4)",
                "line-width": 0.8
              }
            }, baseSymbolLayerId);

            addLayerOnce({
              id: "selected-country-fill",
              type: "fill",
              source: "selected-country-source",
              paint: { "fill-color": "#ffffff", "fill-opacity": 0.15 }
            }, baseSymbolLayerId);

            addLayerOnce({
              id: "selected-country-glow-outer",
              type: "line",
              source: "selected-country-source",
              paint: {
                "line-color": "#ffffff",
                "line-width": ["interpolate", ["linear"], ["zoom"], 1, 3, 5, 6],
                "line-opacity": 1
              }
            }, baseSymbolLayerId);

            addLayerOnce({
              id: "selected-country-outline",
              type: "line",
              source: "selected-country-source",
              paint: {
                "line-color": "#51d1c2",
                "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 5, 3]
              }
            }, baseSymbolLayerId);

            map.on("click", "world-fill", (event) => {
               if (activeView !== "world") return;
               clearHoverPopup();
               const props = event.features[0].properties;
               let fullFeature = event.features[0];
               if (worldFeatureCollection) {
                   const found = worldFeatureCollection.features.find(f => f.properties.ISO_A3 === props.ISO_A3);
                   if (found) fullFeature = found;
               }
               selectCountry(props, fullFeature);
               showCountryPopup(event.lngLat, fullFeature.properties || props);
            });
            map.on("mousemove", "world-fill", (event) => {
               if (activeView !== "world") return;
               map.getCanvas().style.cursor = "pointer";
               showCountryHover(event.lngLat, event.features[0].properties);
            });
            map.on("mouseleave", "world-fill", () => {
               map.getCanvas().style.cursor = "";
               clearHoverPopup();
            });

            hideStatus();
        } catch (e) {
            console.error("Failed to load world", e);
            hideStatus();
        }
    }
    
    syncAtlasLayersForActiveView();
    if (!options.preserveCamera) map.flyTo({ center: [0, 20], zoom: 1.5, speed: 0.8, curve: 1.35, essential: true });
    
    elements["hud-layer"].textContent = "Globo";
    elements["metric-state"].textContent = "Mundo";
    elements["metric-state-pop"].textContent = "8.000.000.000";
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "selecione um país";

    renderSelectedWorld();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    savePreferences();
  }

  function selectCountry(props, feature) {
    props = feature && feature.properties ? { ...props, ...feature.properties } : props;
    const worldHdiSourceIds = activeDataSourceIds();
    const securityWorldSourceIds = activeAnalysis === "security" ? activeDataSourceIds() : ["securityGlobalUnodc"];
    updateSourceDisplays(activeAnalysis === "hdi" ? worldHdiSourceIds : (activeAnalysis === "security" ? securityWorldSourceIds : ["localWorldJson"]));
    if (map.getSource("selected-country-source")) {
       setSourceData("selected-country-source", {
         type: "FeatureCollection",
         features: [feature]
       });
    }
    elements["metric-state"].textContent = props.ISO_A3 || "-";
    elements["metric-state-pop"].textContent = formatNumber(props.pop || 0);
    elements["selected-code"].textContent = props.ISO_A3 || "-";
    elements["selected-type"].textContent = "País";
    elements["selected-name"].textContent = props.name_pt || props.ADMIN || props.name || "Desconhecido";
    elements["selected-pop"].textContent = formatNumber(props.pop || 0);
    elements["selected-share"].textContent = "-";
    elements["selected-area"].textContent = formatArea(props.areaKm2);
    elements["selected-density"].textContent = formatDensity(props.areaKm2 ? props.pop / props.areaKm2 : null);
    elements["selected-rank"].textContent = "-";
    elements["selected-context"].textContent = props.region || "Global";
    
    renderGeneralCards(`${props.name_pt || props.ADMIN || props.name || "Desconhecido"} | ${props.ISO_A3 || "-"}`, [
        { label: "População", value: formatNumber(props.pop || 0) },
        { label: "Área territorial", value: formatArea(props.areaKm2) },
        { label: "Densidade pop.", value: formatDensity(props.areaKm2 ? props.pop / props.areaKm2 : null) },
        ...(activeAnalysis === "hdi" ? [
          { label: `IDH ${props.hdiYear || resolveHdiYear("world")}`, value: formatHdi(props.hdi) },
          { label: "Ranking HDR", value: props.hdiRank ? `${props.hdiRank} de ${hdiCountryCount()}` : "ranking disponível em 2023" },
          { label: "Categoria", value: hdiCategoryLabel(props.hdiCategory) },
          { label: "Histórico IDH", value: renderHdiHistoryChart(props.hdiHistory, resolveHdiYear("world"), false), isHtml: true }
        ] : []),
        ...(activeAnalysis === "security" ? (() => {
          const sourceId = activeSourceOptionId("security", "world");
          if (sourceId === "gpi") {
            return [
              { label: `GPI ${props.securityYear || 2023}`, value: props.gpiScore ? `${props.gpiScore.toFixed(2)}` : "sem dado" },
              { label: "Ranking GPI", value: props.gpiRank ? `${props.gpiRank}º` : "sem dado" },
              { label: "Fonte", value: "Vision of Humanity" }
            ];
          }
          return [
            { label: `Homicídios ${props.securityYear || 2022}`, value: props.homicideRate ? `${props.homicideRate.toFixed(1)} por 100k` : "sem dado" },
            { label: "Fonte", value: props.securitySource || "UNODC" }
          ];
        })() : []),
        { label: "PIB (2024)", value: formatCurrencyShortUSD(props.gdp) },
        { label: "PIB por habitante", value: formatCurrencyUSD(perCapita(props.gdp, props.pop)) },
        { label: "Região", value: props.region || "Global" },
        { label: "Origem do JSON", value: activeAnalysis === "hdi" ? upstreamSourceLine(sourceRecords(worldHdiSourceIds)[0]) : (activeAnalysis === "security" ? upstreamSourceLine(sourceRecords(securityWorldSourceIds)[0]) : upstreamSourceLine(DATA_SOURCE_CATALOG.localWorldJson)) }
    ]);
    elements["general-note"].textContent = activeAnalysis === "hdi"
      ? `IDH global. Fonte/procedência: ${sourceDetailsLine(worldHdiSourceIds)}.`
      : (activeAnalysis === "security"
        ? `Dados de segurança global. Fonte/procedência: ${sourceDetailsLine(securityWorldSourceIds)}.`
        : `Dados globais carregados de base JSON local. Fonte/procedência: ${sourceDetailsLine(["localWorldJson"])}.`);
  }

  function showCountryHover(lngLat, props) {
    if (!hoverCardsEnabled) return;
    clearHoverPopup();
    const name = props.name_pt || props.ADMIN || props.name || "Desconhecido";
    let html = `<div class="font-bold mb-1">${escapeHtml(name)}</div>
      <div class="text-xs text-gray-400 mb-2">${escapeHtml(props.ISO_A3)}</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span class="text-gray-400">População</span>
        <span class="text-right font-medium text-white">${formatShort(props.pop || 0)}</span>
        <span class="text-gray-400">Área</span>
        <span class="text-right font-medium text-white">${formatArea(props.areaKm2)}</span>
        <span class="text-gray-400">PIB (24)</span>
        <span class="text-right font-medium text-white">${formatCurrencyShortUSD(props.gdp)}</span>
        <span class="text-gray-400">PIB/Hab</span>
        <span class="text-right font-medium text-white">${formatCurrencyUSD(perCapita(props.gdp, props.pop))}</span>
        ${activeAnalysis === "hdi" ? `
          <span class="text-gray-400">IDH ${escapeHtml(props.hdiYear || resolveHdiYear("world"))}</span>
          <span class="text-right font-medium text-white">${formatHdi(props.hdi)}</span>
        ` : ""}
        ${activeAnalysis === "security" ? (() => {
          const sourceId = activeSourceOptionId("security", "world");
          if (sourceId === "gpi") {
            return `
              <span class="text-gray-400">GPI</span>
              <span class="text-right font-medium text-white">${props.gpiScore ? props.gpiScore.toFixed(2) : "-"}</span>
              <span class="text-gray-400">Ranking GPI</span>
              <span class="text-right font-medium text-white">${props.gpiRank ? props.gpiRank + "º" : "-"}</span>
            `;
          }
          return `
            <span class="text-gray-400">Homicídios</span>
            <span class="text-right font-medium text-white">${props.homicideRate ? props.homicideRate.toFixed(1) + " /100k" : "-"}</span>
          `;
        })() : ""}
      </div>`;
    
    hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "atlas-popup", maxWidth: "260px" })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  function showCountryPopup(lngLat, props) {
    if (activeAnalysis === "hdi" && props && props.hdiHistory) {
      const year = resolveHdiYear("world");
      props = {
        ...props,
        hdi: hdiValueForYear(props.hdiHistory, year),
        hdiYear: year,
        hdiRank: rankHdiByYear(activeGlobalHdiDataset(), props.ISO_A3, year)
      };
    }
    const name = props.name_pt || props.ADMIN || props.name || "Desconhecido";
    const rows = [
      { label: "População", value: formatNumber(props.pop || 0) },
      { label: "Área territorial", value: formatArea(props.areaKm2) },
      { label: "Densidade pop.", value: formatDensity(props.areaKm2 ? props.pop / props.areaKm2 : null) },
      { label: "PIB (2024)", value: formatCurrencyShortUSD(props.gdp) },
      { label: "PIB por hab.", value: formatCurrencyUSD(perCapita(props.gdp, props.pop)) },
      ...(activeAnalysis === "hdi" ? [
        { label: `IDH ${props.hdiYear || resolveHdiYear("world")}`, value: formatHdi(props.hdi) },
        { label: "Ranking HDR", value: props.hdiRank ? `${props.hdiRank} de ${hdiCountryCount()}` : "ranking disponível em 2023" },
        { label: "Categoria", value: hdiCategoryLabel(props.hdiCategory) }
      ] : []),
      ...(activeAnalysis === "security" ? (() => {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          return [
            { label: `GPI ${props.securityYear || 2023}`, value: props.gpiScore ? `${props.gpiScore.toFixed(2)}` : "sem dado" },
            { label: "Ranking GPI", value: props.gpiRank ? `${props.gpiRank}º` : "sem dado" },
            { label: "Fonte", value: "Vision of Humanity" }
          ];
        }
        return [
          { label: `Homicídios ${props.securityYear || 2022}`, value: props.homicideRate ? `${props.homicideRate.toFixed(1)} por 100k` : "sem dado" },
          { label: "Fonte", value: props.securitySource || "UNODC" }
        ];
      })() : []),
      { label: "Região", value: props.region || "Global" }
    ];
    showFixedDetailCard("País", `${name} (${props.ISO_A3 || "-"})`, rows, props);
  }

  window.updateWorldLayerColor = function updateWorldLayerColor() {
    if (!map.getLayer("world-fill")) return;
    let colorExpr;
    if (activeAnalysis === "hdi") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "hdi"], 0],
        0.35, "#17212b",
        0.55, "#335c67",
        0.7, "#4f8f70",
        0.8, "#a9d65c",
        0.9, "#f2c14e"
      ];
    } else if (activeWorldMetric === "pop") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "pop"], 0],
        0, "#17212b",
        1000000, "#25534e",
        10000000, "#5b8e54",
        50000000, "#c59b3f",
        200000000, "#ef7d60",
        1000000000, "#b799ff"
      ];
    } else if (activeWorldMetric === "area") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "areaKm2"], 0],
        0, "#17212b",
        10000, "#25534e",
        100000, "#5b8e54",
        500000, "#c59b3f",
        2000000, "#ef7d60",
        10000000, "#b799ff"
      ];
    } else if (activeWorldMetric === "density") {
      colorExpr = [
        "interpolate", ["linear"], 
        ["/", ["to-number", ["get", "pop"], 0], ["max", ["to-number", ["get", "areaKm2"], 1], 1]],
        0, "#17212b",
        10, "#25534e",
        50, "#5b8e54",
        150, "#c59b3f",
        500, "#ef7d60",
        1000, "#b799ff"
      ];
    } else if (activeWorldMetric === "gdp") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "gdp"], 0],
        0, "#17212b",
        10000000000, "#25534e",
        100000000000, "#5b8e54",
        500000000000, "#c59b3f",
        2000000000000, "#ef7d60",
        10000000000000, "#b799ff"
      ];
    } else if (activeWorldMetric === "gdpPerCapita") {
      colorExpr = [
        "interpolate", ["linear"], 
        ["/", ["to-number", ["get", "gdp"], 0], ["max", ["to-number", ["get", "pop"], 1], 1]],
        0, "#17212b",
        2000, "#25534e",
        5000, "#5b8e54",
        15000, "#c59b3f",
        35000, "#ef7d60",
        60000, "#b799ff"
      ];
    }
    if (activeAnalysis === "security") {
      const sourceId = activeSourceOptionId("security", "world");
      if (sourceId === "gpi") {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", "gpiScore"], 0],
          1.0, "#1a5f8a",
          1.5, "#4f8f70",
          2.0, "#a9d65c",
          2.5, "#f2c14e",
          3.0, "#ef7d60",
          3.5, "#ff3b3b"
        ];
      } else {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", "homicideRate"], 0],
          0, "#17212b",
          5, "#5c3a1e",
          15, "#a0522d",
          30, "#ef7d60",
          50, "#ff3b3b"
        ];
      }
    }
    map.setPaintProperty("world-fill", "fill-color", colorExpr);
  }

})();
