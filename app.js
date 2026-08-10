(function () {
  "use strict";

  // Proteção contra Clickjacking (Frame-Busting)
  if (window.self !== window.top) {
    window.top.location = window.self.location;
  }


  const LATEST_OFFICIAL_GDP_YEAR = "2023";

  // O mapa oficial do IPS é CLASSIFICADO em 9 grupos (quebras naturais), não um
  // gradiente contínuo. Interpolar amarelo -> azul em RGB passa por cinza-oliva, e
  // como 20 das 27 UFs caem justamente nessa faixa, o mapa lia como homogêneo.
  // Com classes discretas cada grupo tem cor própria e saturada, como na fonte.
  // Ordem: pior (vermelho escuro) -> melhor (azul escuro).
  const IPS_CLASS_COLORS = [
    "#8f2820", "#c8402f", "#e8743b", "#ef9f52", "#f2c14e",
    "#bcd08a", "#7fbcd8", "#3a8fc7", "#1c5f9e"
  ];
  // Fallback só para o caso de o JSON não trazer classBreaks (dado antigo em cache).
  const IPS_FALLBACK_BREAKS = [48.53, 52.0, 54.62, 56.86, 58.88, 60.86, 63.05, 66.29];
  const APP_VERSION = "2.1.0-parquet";

  const OFFLINE_MAP_STYLE = {
    version: 8,
    name: "Atlas Brasil Offline",
    sources: {},
    layers: [{
      id: "offline-background",
      type: "background",
      paint: { "background-color": "#07131c" }
    }]
  };

  const URLS = {
    mapStyle: OFFLINE_MAP_STYLE
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
      shortLabel: "Parquet local",
      provider: "data/parquet/site/atlas/world_data.parquet",
      type: "parquet",
      provenance: "compilado",
      freshness: "Base local versionada no repositório",
      url: "./data/parquet/site/atlas/world_data.parquet",
      upstreamLabel: "datasets/geo-countries + World Bank",
      upstreamSources: [
        {
          label: "datasets/geo-countries",
          url: "https://github.com/datasets/geo-countries",
          fields: "geometria e códigos ISO",
          usage: "base geométrica dos países"
        },
        {
          label: "World Bank API",
          url: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD",
          fields: "população e PIB nominal em US$",
          usage: "indicadores demográfico e econômico globais"
        }
      ],
      quality: "Compilado",
      fields: ["geometria", "ISO_A3", "população", "área geodésica calculada", "nome", "PIB nominal em US$"],
      methodology: "Arquivo gerado por fetch_world_data.py: baixa a geometria, calcula a área geodésica, consulta população e PIB no World Bank e faz o merge por código ISO_A3.",
      limitations: ["A precisão depende da atualização de cada fonte original.", "Países sem ISO_A3 compatível podem ficar sem enriquecimento completo.", "O arquivo é local: precisa ser regerado para refletir mudanças nas fontes upstream."],
      updatePolicy: "Reexecutar fetch_world_data.py e revisar o diff do GeoJSON quando quiser atualizar a base global.",
      note: "GeoParquet local gerado por fetch_world_data.py a partir de fontes oficiais consolidadas."
    },
    hdiGlobalUndp: {
      label: "IDH global",
      shortLabel: "UNDP HDR",
      provider: "UNDP Human Development Report Data Center",
      type: "parquet",
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
          usage: "arquivo bruto convertido para data/parquet/site/atlas/hdi_global.parquet"
        }
      ],
      quality: "Oficial",
      fields: ["ISO3", "país", "IDH anual 1990-2023", "ranking IDH 2023", "categoria HDR"],
      methodology: "O Parquet local foi gerado a partir do CSV oficial de séries temporais do HDR, mantendo apenas os campos de IDH necessários para mapa, ranking e gráfico.",
      limitations: ["A comparação global usa países com ISO3 compatível no GeoParquet local.", "O ano mais recente disponível nessa base é 2023.", "IDH global e IDHM brasileiro são métricas relacionadas, mas não idênticas metodologicamente."],
      updatePolicy: "Executar o ETL do HDR, regenerar hdi_global.parquet e conferir ano, ranking e cobertura por ISO3.",
      note: "Dado real oficial do UNDP/HDR, carregado por Parquet local versionado."
    },
    hdiGlobalOwid: {
      label: "IDH global via OWID",
      shortLabel: "OWID/UNDP",
      provider: "Our World in Data",
      type: "parquet",
      provenance: "compilado",
      freshness: "IDH 2023; série histórica 1990-2023; OWID atualizado em 2025-05-07",
      url: "https://ourworldindata.org/grapher/human-development-index",
      upstreamLabel: "Our World in Data + UNDP Human Development Report 2025",
      upstreamSources: [
        {
          label: "Our World in Data Grapher",
          url: "https://ourworldindata.org/grapher/human-development-index",
          fields: "Entity, Code, Year, Human Development Index e região OWID",
          usage: "CSV processado para data/parquet/site/atlas/hdi_owid.parquet"
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
      methodology: "O Parquet local foi gerado a partir do CSV do Grapher do OWID. O OWID cita UNDP/HDR 2025 como fonte original e aplica processamento menor para padronizar a série no ecossistema OWID.",
      limitations: ["Não é a fonte primária; é uma redistribuição/processamento do OWID sobre dados UNDP.", "Pode ter cobertura ou metadados ligeiramente diferentes do CSV oficial HDR.", "Use UNDP/HDR quando a prioridade for fonte primária; use OWID quando a prioridade for documentação editorial e integração com séries OWID."],
      updatePolicy: "Executar o ETL do OWID, regenerar hdi_owid.parquet e revisar latestYear/cobertura.",
      note: "Dado compilado pelo OWID a partir do UNDP/HDR 2025, com metadados editoriais."
    },
    idhmPnudBrazil: {
      label: "IDHM Brasil e UFs",
      shortLabel: "PNUD IDHM",
      provider: "PNUD Brasil, IPEA, FJP e IBGE/PNAD Contínua",
      type: "parquet",
      provenance: "real",
      freshness: "IDHM anual 2012-2024 para Brasil e UFs (Radar IDHM 2026)",
      url: "https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm",
      upstreamLabel: "Radar IDHM 2026 (PNUD/IPEA-FJP/IBGE)",
      upstreamSources: [
        {
          label: "Painel IDHM - PNUD Brasil",
          url: "https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm",
          fields: "metodologia, escopo territorial e base anual",
          usage: "referência metodológica e página pública da fonte"
        },
        {
          label: "Relatório Radar IDHM 2026 (PDF)",
          url: "https://www.undp.org/pt/brazil/publications/radar-idhm-evolucao-do-idhm-e-de-seus-componentes-periodo-de-2012-2024",
          fields: "Tabelas-anexo: IDHM e subíndices (Educação, Longevidade, Renda) por UF e Brasil, 2012 a 2024; IDHMAD do Brasil",
          usage: "série anual convertida para data/parquet/site/atlas/idhm_brazil.parquet"
        },
        {
          label: "PNAD Contínua/IBGE",
          url: "https://www.ibge.gov.br/estatisticas/sociais/trabalho/9171-pesquisa-nacional-por-amostra-de-domicilios-continua-mensal.html",
          fields: "insumos demográficos, renda e educação",
          usage: "base estatística usada pelo IDHM anual"
        }
      ],
      quality: "Oficial",
      fields: ["IDHM", "IDHM Longevidade", "IDHM Educação", "IDHM Renda", "IDHMAD (Brasil)"],
      methodology: "idhm_brazil.parquet traz a série recalculada 2012-2024 do Radar IDHM 2026. IDHM e os três subíndices vêm das tabelas por UF e do Brasil; o IDHMAD geral só é publicado para o Brasil.",
      limitations: ["Série anual cobre Brasil e UFs de 2012 a 2024 (a edição 2026 recalculou toda a série).", "IDHMAD geral não é publicado por UF, só para o Brasil; nas UFs esse campo fica sem dado.", "Não é uma série municipal anual.", "IDHM brasileiro e IDH global não devem ser misturados em ranking único."],
      updatePolicy: "Preferir a planilha oficial: scripts/generate_idhm_brazil.py --url <url do .xlsx do Painel IDHM>. Enquanto só houver o relatório em PDF (como na edição 2026), usar scripts/extract_idhm_from_radar_pdf.py. Veja docs/DADOS.md.",
      note: "Dado real oficial do Radar IDHM 2026 (PNUD/IPEA-FJP/IBGE), série 2012-2024 com componentes."
    },
    idhmCityProxy: {
      label: "IDHM de municípios",
      shortLabel: "Proxy UF",
      provider: "Cálculo local a partir do IDHM da UF",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado do ano ativo do IDHM estadual",
      quality: "Proxy transparente",
      fields: ["IDHM estadual do ano ativo", "código da UF", "município selecionado"],
      methodology: "Como a base anual carregada não traz IDHM municipal, cada município recebe temporariamente o IDHM da sua UF para permitir navegação e comparação visual dentro do mapa.",
      limitations: ["Não é IDHM municipal real.", "Não deve ser usado para ranking municipal, tomada de decisão local ou comparação entre municípios.", "O Atlas Brasil possui IDHM municipal em anos censitários, mas essa base ainda não foi integrada nesta versão."],
      updatePolicy: "Substituir este proxy por uma base municipal auditável, informando anos censitários, arquivo bruto, campos usados e script de normalização.",
      note: "Marcado como estimado para evitar falsa precisão em municípios."
    },
    ipsBrasilImazon: {
      label: "IPS Brasil e UFs",
      shortLabel: "IPS Brasil",
      provider: "Instituto IPS Brasil, Imazon, Amazônia 2030 e Social Progress Imperative",
      type: "parquet",
      provenance: "real",
      freshness: "IPS Brasil 2026 (3ª edição), série recalculada 2024-2026",
      url: "https://ipsbrasil.org.br",
      upstreamLabel: "Relatório geral do IPS Brasil 2026 (PDF)",
      upstreamSources: [
        {
          label: "IPS Brasil - painel de dados",
          url: "https://ipsbrasil.org.br/explore/data",
          fields: "IPS geral, 3 dimensões, 12 componentes e 57 indicadores por município",
          usage: "página pública da fonte; o painel é Phoenix LiveView e não expõe planilha por URL estável"
        },
        {
          label: "Relatório geral IPS Brasil 2026 (PDF)",
          url: "https://ipsbrasil.org.br/relatorios",
          fields: "Quadro 11 (IPS das 27 UFs com ranking), seção Resultados (Brasil e dimensões) e série temporal 2024-2026",
          usage: "extraído e convertido para data/parquet/site/atlas/ips_brazil.parquet"
        },
        {
          label: "Social Progress Imperative",
          url: "https://www.socialprogress.org/social-progress-index",
          fields: "metodologia do Social Progress Index",
          usage: "referência metodológica do índice (dimensões, componentes e escala 0-100)"
        }
      ],
      quality: "Oficial",
      fields: ["IPS geral (0-100)", "Necessidades Humanas Básicas", "Fundamentos do Bem-estar", "Oportunidades", "Ranking entre UFs"],
      methodology: "IPS mede resultados sociais e ambientais (sem indicadores econômicos), em escala 0-100. O Parquet local traz Brasil, 27 UFs e a série nacional recalculada de 2024 a 2026.",
      limitations: [
        "Esta base cobre Brasil e UFs; o IPS municipal dos 5.570 municípios existe no painel oficial mas ainda não foi integrado.",
        "As edições 2024, 2025 e 2026 não são estritamente comparáveis entre si (mudaram indicadores e tratamentos); a série 2024-2026 publicada no relatório é um recálculo com os parâmetros de 2026.",
        "IPS Brasil e IPS Global não são comparáveis: o Brasil marca 72,74 no IPS Global 2026 e 63,40 no IPS Brasil 2026, porque o conjunto de indicadores é diferente.",
        "Subnotificação é um risco reconhecido pela fonte, sobretudo nos componentes Segurança Pessoal e Saúde e Bem-estar."
      ],
      updatePolicy: "Rodar scripts/generate_ips_brazil.py (baixa o relatório geral vigente de https://ipsbrasil.org.br/relatorios, extrai e valida contra âncoras oficiais). Veja docs/DADOS.md.",
      note: "Dado real oficial do IPS Brasil 2026 (Imazon/Instituto IPS Brasil), Brasil e 27 UFs."
    },
    ipsBrasilCities: {
      label: "IPS dos 5.570 municípios",
      shortLabel: "IPS municipal",
      provider: "Instituto IPS Brasil, Imazon, Amazônia 2030 e Social Progress Imperative",
      type: "parquet",
      provenance: "real",
      freshness: "IPS Brasil 2026, tabela municipal completa",
      url: "https://ipsbrasil.org.br/explore/data",
      upstreamLabel: "Planilha oficial \"Dataset completo (todos os municípios)\"",
      upstreamSources: [
        {
          label: "Tabela municipal do IPS Brasil (XLSX)",
          url: "https://ips-brasil.fly.storage.tigris.dev/downloads/ips-brasil-2026-tabela.xlsx",
          fields: "IPS geral, 3 dimensões, 12 componentes e 57 indicadores para 5.570 municípios",
          usage: "convertida para Parquet municipal versionado pelo ETL"
        },
        {
          label: "Localidades IBGE",
          url: "https://servicodados.ibge.gov.br/api/docs/localidades",
          fields: "código IBGE de 7 dígitos por município",
          usage: "a planilha do IPS traz só Município+UF; o código vem daqui para casar com o mapa"
        }
      ],
      quality: "Oficial",
      fields: ["IPS geral (0-100)", "Ranking nacional (x/5.570)", "Necessidades Humanas Básicas", "Fundamentos do Bem-estar", "Oportunidades"],
      methodology: "Planilha municipal oficial da edição vigente, convertida para Parquet e indexada por código IBGE. A conversão é validada contra o relatório e contra municípios de referência.",
      limitations: [
        "5.570 unidades de análise incluem Brasília (DF) e Fernando de Noronha (PE); Boa Esperança do Norte (MT), criado em 2025, não tem IPS.",
        "Edições 2024, 2025 e 2026 não são estritamente comparáveis entre si.",
        "O Parquet publicado traz IPS geral, ranking e as 3 dimensões; os componentes adicionais permanecem disponíveis no ETL.",
        "Subnotificação é risco reconhecido pela fonte, sobretudo em Segurança Pessoal e Saúde e Bem-estar."
      ],
      updatePolicy: "Rodar scripts/generate_ips_brazil.py (baixa a planilha, casa com o IBGE e valida contra o relatório). Veja docs/DADOS.md.",
      note: "Dado real oficial por município, não proxy."
    },
    ipsCityProxy: {
      label: "IPS de municípios (fallback)",
      shortLabel: "Proxy UF",
      provider: "Cálculo local a partir do IPS da UF",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado do IPS estadual da edição vigente",
      quality: "Proxy transparente",
      fields: ["IPS da UF", "código da UF", "município selecionado"],
      methodology: "Fallback: se a base municipal não carregar ou um município não estiver nela, ele recebe o IPS da sua UF só para o mapa não ficar vazio.",
      limitations: [
        "Não é IPS municipal real: o IPS oficial varia muito dentro de uma mesma UF (de 42 a 73 no país).",
        "Não deve ser usado para ranking municipal nem para decisão local.",
        "Com a base municipal carregada, esse proxy não é usado."
      ],
      updatePolicy: "Regenerar os Parquets municipais do IPS junto com a edição oficial vigente.",
      note: "Marcado como estimado para evitar falsa precisão em municípios."
    },
    securityGlobalUnodc: {
      label: "Homicídios globais",
      shortLabel: "UNODC",
      provider: "UNODC / Global Study on Homicide",
      type: "parquet",
      provenance: "real",
      freshness: "UNODC 2022-2023 consolidated",
      url: "https://dataunodc.un.org/data/crime/cts-intentional-homicide",
      quality: "Oficial com fallback local",
      fields: ["ISO3", "homicide rate per 100k", "ano de referência"],
      methodology: "Taxa de homicídios intencionais por 100 mil habitantes compilada do UNODC Global Study on Homicide.",
      limitations: ["Conjunto fallback com países selecionados.", "Algumas taxas refletem anos de referência diferentes (2021-2023).", "Países sem dados ficam sem valor no mapa."],
      updatePolicy: "Executar o ETL do UNODC e regenerar security_global.parquet.",
      note: "Dado real oficial do UNODC; fallback local usado para cobertura inicial."
    },
    securityGlobalGpi: {
      label: "Global Peace Index",
      shortLabel: "GPI",
      provider: "Vision of Humanity / IEP",
      type: "parquet",
      provenance: "real",
      freshness: "GPI 2024",
      url: "https://visionofhumanity.org",
      quality: "Oficial com fallback local",
      fields: ["ISO3", "GPI Score", "GPI Rank"],
      methodology: "Global Peace Index (GPI) mede a paz relativa de nações usando indicadores de criminalidade, terrorismo, militarização e conflitos. Escala 1-5 (1 = mais pacífico, 5 = menos pacífico).",
      limitations: ["Conjunto fallback com países selecionados.", "GPI é composto por múltiplos indicadores, não apenas violência letal.", "Países sem dados ficam sem valor no mapa."],
      updatePolicy: "Executar o ETL e regenerar security_global.parquet.",
      note: "Dado real do Institute for Economics & Peace."
    },
    securityBrazilFBSP: {
      label: "Segurança Pública Brasil",
      shortLabel: "FBSP/IPEA",
      provider: "FBSP Anuário Brasileiro / IPEA Atlas da Violência",
      type: "parquet",
      provenance: "real",
      freshness: "FBSP Anuário 2024 (dados 2023)",
      url: "https://forumseguranca.org.br",
      quality: "Oficial",
      fields: ["UF", "MVI por 100k", "Roubo Veículos por 100k", "Feminicídio por 100k", "Violência Doméstica por 100k", "ano-base"],
      methodology: "MVI = homicídio doloso + latrocínio + lesão corporal seguida de morte + mortes por intervenção policial. Roubo de veículos = roubo + furto. Feminicídio e violência doméstica baseados em registros policiais e consolidados oficiais.",
      limitations: ["Dados estaduais do Anuário FBSP 2024 (ano-base 2023).", "Violência doméstica pode ter subnotificação regional.", "Divergências esperadas entre FBSP (polícia) e Atlas da Violência (SUS/óbito)."],
      updatePolicy: "Executar o ETL do FBSP e regenerar security_brazil.parquet.",
      note: "Dado real oficial do FBSP e IPEA."
    },
    securityBrazilIPEACities: {
      label: "Homicídios municipais",
      shortLabel: "IPEA Atlas",
      provider: "IPEA Atlas da Violência 2024 / FBSP / SIM-MS / IBGE",
      type: "parquet",
      provenance: "official_extracted_pdf",
      freshness: "Atlas da Violência 2024, ano-base 2022",
      url: "https://repositorio.ipea.gov.br/bitstream/11058/14031/5/AtlasViolencia2024_Retrato_dos_municipios_brasileros.pdf",
      quality: "Oficial, extraído da Tabela 2 do PDF",
      fields: ["código IBGE", "homicídios estimados", "homicídios por 100k", "ano"],
      methodology: "Taxa de homicídios estimados por 100 mil habitantes. Soma homicídios registrados e homicídios ocultos estimados, conforme metodologia do Atlas.",
      limitations: ["Cobertura restrita aos 319 municípios com mais de 100 mil habitantes em 2022.", "Municípios sem dado usam proxy pela UF.", "Os demais indicadores municipais da aba continuam sendo proxy estadual."],
      updatePolicy: "Atualizar a fonte municipal do IPEA e regenerar security_brazil_cities.parquet.",
      note: "Dado oficial do IPEA/FBSP para 319 municípios; os demais usam proxy UF."
    },
    securityBrazilCityProxy: {
      label: "Segurança de municípios (Proxy)",
      shortLabel: "Proxy UF",
      provider: "Cálculo local a partir do estado",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado da UF",
      quality: "Proxy transparente",
      fields: ["indicador estadual ativo", "código da UF", "município selecionado"],
      methodology: "Quando não há dado municipal real do IPEA, o município recebe o indicador da sua UF para permitir navegação visual.",
      limitations: ["Não é dado municipal real.", "Não deve ser usado para ranking municipal ou tomada de decisão local.", "Prioridade é dada ao dado IPEA quando disponível."],
      updatePolicy: "Substituir por base municipal auditável quando disponível.",
      note: "Fallback transparente quando IPEA não cobre o município."
    },
    healthGlobalWho: {
      label: "Saude global",
      shortLabel: "WHO/GHO",
      provider: "WHO Global Health Observatory",
      type: "parquet",
      provenance: "compilado",
      freshness: "Indicadores 2021-2023, conforme pais e variavel",
      url: "https://www.who.int/data/gho",
      upstreamLabel: "WHO/GHO + World Bank WDI + IHME GBD",
      upstreamSources: [
        { label: "WHO Global Health Observatory", url: "https://www.who.int/data/gho/data/indicators/indicators-index", fields: "leitos por 10.000, profissionais, UHC, HALE e mortalidade", usage: "fonte primaria para comparacao mundial" },
        { label: "World Bank WDI", url: "https://api.worldbank.org/v2/", fields: "expectativa de vida, gasto em saude e indicadores WDI", usage: "API alternativa e normalizacao por ISO3" },
        { label: "IHME GBD", url: "https://vizhub.healthdata.org/gbd-results/", fields: "carga de doenca e expectativa de vida saudavel", usage: "contexto de perda de saude" }
      ],
      quality: "Compilado para MVP",
      fields: ["ISO3", "expectativa de vida", "HALE", "UHC", "leitos/10k", "medicos/10k", "enfermagem/10k", "gasto em saude"],
      methodology: "health_global.parquet normaliza indicadores internacionais por ISO3 para o mapa global.",
      limitations: ["Cobertura inicial de paises selecionados.", "Indicadores podem ter anos de referencia diferentes.", "Use como panorama comparativo inicial, nao como base epidemiologica final."],
      updatePolicy: "Executar o ETL WHO/GHO e WDI, preservar o ano e regenerar health_global.parquet.",
      note: "Base inicial para comparacao global de saude."
    },
    healthGlobalWorldBank: {
      label: "Saude global via WDI",
      shortLabel: "World Bank",
      provider: "World Bank World Development Indicators",
      type: "api",
      provenance: "real",
      freshness: "Series anuais variaveis, muitas com historico desde 1960",
      url: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
      quality: "Oficial",
      fields: ["SH.MED.BEDS.ZS", "SH.MED.PHYS.ZS", "SP.DYN.LE00.IN", "SH.XPD.CHEX.GD.ZS", "SH.UHC.SRVS.CV.XD"],
      methodology: "API alternativa para obter indicadores de saude por pais. Muitas series do WDI redistribuem dados da OMS, ONU e fontes nacionais.",
      limitations: ["Nao substitui a OMS como fonte primaria de metadados de saude.", "A cobertura e o ultimo ano variam por pais e indicador."],
      updatePolicy: "Consultar https://api.worldbank.org/v2/country/all/indicator/{CODIGO}?format=json&per_page=20000 para cada indicador.",
      note: "Fonte alternativa para divergencias e series historicas."
    },
    healthBrazilDatasus: {
      label: "Saude Brasil",
      shortLabel: "DATASUS/CNES",
      provider: "DATASUS, CNES, SIM, SINASC, SIH/SUS e IBGE",
      type: "parquet",
      provenance: "compilado",
      freshness: "Base inicial 2022-2024, conforme indicador",
      url: "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/",
      upstreamLabel: "CNES + SIM + SINASC + SIH/SUS + IBGE",
      upstreamSources: [
        { label: "CNES/DATASUS", url: "https://estabelecimentos.datasus.gov.br/pages/consultas.jsp", fields: "estabelecimentos, leitos, UTI, profissionais e equipamentos", usage: "capacidade instalada" },
        { label: "SIM/DATASUS", url: "https://opendatasus.saude.gov.br/dataset/sim", fields: "obitos e causas CID-10", usage: "mortalidade e resultados de saude" },
        { label: "SINASC/DATASUS", url: "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/", fields: "nascidos vivos, pre-natal, peso ao nascer", usage: "denominador de mortalidade infantil/materna" },
        { label: "IBGE/SIDRA", url: "https://sidra.ibge.gov.br/tabela/6579", fields: "populacao por UF e municipio", usage: "denominador per capita" }
      ],
      quality: "Compilado para MVP",
      fields: ["leitos/1.000", "leitos SUS/1.000", "UTI/100k", "medicos/1.000", "enfermeiros/1.000", "mortalidade infantil", "mortalidade materna", "vacinacao", "saude suplementar"],
      methodology: "health_brazil.parquet traz indicadores estaduais normalizados por população e registra os proxies territoriais.",
      limitations: ["Primeira versão compilada e arredondada.", "Municípios ainda não usam dado CNES/SIM/SINASC real próprio.", "Indicadores de capacidade e resultado não devem ser somados em um único ranking sem metodologia."],
      updatePolicy: "Criar extrator oficial para CNES, SIM, SINASC, SIH/SUS, ANS/SIOPS e IBGE, preservando competencia/ano.",
      note: "Base inicial para panorama brasileiro de saude."
    },
    healthBrazilCitiesDatasus: {
      label: "Saude municipal",
      shortLabel: "DATASUS municipal",
      provider: "CNES, SIM, SINASC, SI-PNI e IBGE",
      type: "parquet",
      provenance: "compilado",
      freshness: "Base municipal inicial 2022-2024, conforme indicador",
      url: "./data/parquet/site/atlas/health_brazil_cities.parquet",
      upstreamLabel: "CNES + SIM + SINASC + SI-PNI + IBGE por codigo municipal",
      upstreamSources: [
        { label: "CNES/DATASUS", url: "https://cnes.datasus.gov.br/", fields: "leitos, UTI, estabelecimentos e profissionais por município", usage: "capacidade instalada municipal" },
        { label: "SIM/DATASUS", url: "https://opendatasus.saude.gov.br/dataset/sim", fields: "obitos por municipio de residencia", usage: "mortalidade infantil e materna" },
        { label: "SINASC/DATASUS", url: "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/", fields: "nascidos vivos por municipio de residencia", usage: "denominador de mortalidade" },
        { label: "SI-PNI/DATASUS", url: "https://opendatasus.saude.gov.br/", fields: "cobertura vacinal municipal", usage: "prevencao e imunizacao" },
        { label: "IBGE", url: "https://servicodados.ibge.gov.br/api/docs/localidades", fields: "codigo IBGE e populacao", usage: "join territorial e denominadores" }
      ],
      quality: "Cobertura municipal inicial",
      fields: ["codigo IBGE", "leitos/1.000", "leitos SUS/1.000", "UTI/100k", "medicos/1.000", "mortalidade infantil", "mortalidade materna", "vacinacao"],
      methodology: "O app usa dados municipais quando o código IBGE aparece no Parquet. Municípios sem linha própria continuam com proxy da UF, explicitamente sinalizado.",
      limitations: ["Cobertura inicial parcial.", "Municípios polo podem concentrar hospitais que atendem população regional.", "Mortalidade em municípios pequenos deve preferir média móvel de 3 anos na próxima geração automatizada."],
      updatePolicy: "Gerar o JSON completo a partir de CNES/SIM/SINASC/SI-PNI/IBGE por codigo IBGE de 7 digitos.",
      note: "Dado municipal quando disponivel; fallback transparente pela UF."
    },
    healthBrazilCityProxy: {
      label: "Saúde de municípios",
      shortLabel: "Proxy UF",
      provider: "Calculo local a partir dos indicadores estaduais",
      type: "computed",
      provenance: "estimado",
      freshness: "Proxy derivado da UF",
      quality: "Proxy transparente",
      fields: ["indicador estadual ativo", "código da UF", "município selecionado"],
      methodology: "Enquanto a extração municipal do CNES/DATASUS não está integrada, o município recebe o indicador da sua UF para permitir navegação visual.",
      limitations: ["Nao e dado municipal real.", "Nao deve ser usado para ranking municipal final.", "Polos regionais podem atender populacao de varios municipios, exigindo leitura por local de residencia e local de atendimento."],
      updatePolicy: "Substituir por base municipal auditavel do CNES, SIM, SINASC, SIH/SUS e IBGE por codigo IBGE de 7 digitos.",
      note: "Fallback transparente ate integrar dado municipal."
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
      fields: ["município", "URL do vídeo", "título", "canal"],
      methodology: "Lista manual mantida em DOCUMENTED_CITIES, usada para destacar municípios com documentários.",
      limitations: ["Cobertura depende de curadoria; ausência de vídeo não significa ausência de conteúdo público sobre o município."],
      updatePolicy: "Adicionar novos municípios com URL, título, canal e checagem manual do link.",
      note: "Lista manual de municípios com documentário e metadados de vídeo."
    },
    storiesAi: {
      label: "Histórias de municípios",
      shortLabel: "IA + IBGE",
      provider: "data/parquet/site/atlas/stories_brazil_cities.parquet",
      type: "parquet",
      provenance: "gerado por IA",
      freshness: "Piloto gerado em 2026-07-19",
      url: "./data/parquet/site/atlas/stories_brazil_cities.parquet",
      quality: "Texto de IA ancorado em dados oficiais",
      fields: ["arquétipo", "história (até 6 frases)", "sinais usados", "lacunas", "confiança", "hash do material-fonte"],
      methodology: "scripts/generate_city_stories.py coleta população, PIB, composição do VAB e o histórico oficial do portal do IBGE; o prompt-mestre instrui o modelo a escrever no máximo 6 frases usando apenas esse material, com inferências sinalizadas e arquétipo da paleta.",
      limitations: ["Texto gerado por IA: pode conter leituras imprecisas mesmo ancorado nos dados.", "VAB municipal disponível até 2021; PIB total até 2023.", "Piloto com 10 municípios; cobertura completa depende de validação da ideia."],
      updatePolicy: "Regenerar com o script + prompt-mestre e revisar antes de publicar; guardar hash do material por município.",
      note: "História socioeconômica curta por município, gerada por IA a partir de dados IBGE e auditada contra o material-fonte."
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
      title: "Desenvolvimento humano no mundo, Brasil, estados e municípios",
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
      note: "No Globo, usa IDH global oficial do UNDP/HDR. No Brasil e UFs, usa IDHM anual do Painel IDHM/PNUD. Em municípios, a camada aparece como proxy pela UF até integrar uma base municipal auditável."
    },
    ips: {
      label: "IPS",
      caption: "Progresso social",
      icon: "sprout",
      group: "primary",
      title: "Índice de Progresso Social: resultados sociais e ambientais (0-100)",
      defaultMetric: "ipsGeral",
      metricStateKey: "ipsSubMetric",
      sourceIds: ["ipsBrasilImazon", "ipsBrasilCities"],
      // Só o índice geral está integrado. As dimensões e os 12 componentes do IPS
      // entram aqui conforme forem extraídos da fonte; o seletor da legenda já
      // lê este mapa, então basta acrescentar as chaves.
      metrics: {
        // label = texto curto do seletor (dividindo espaço com o seletor de ano);
        // metric = nome completo usado nos títulos e na legenda.
        ipsGeral: { label: "IPS Geral", metric: "IPS geral (0-100)", sourceIds: ["ipsBrasilImazon"] },
        basicNeeds: { label: "Necessidades", metric: "Necessidades Humanas Básicas", sourceIds: ["ipsBrasilImazon"] },
        wellbeing: { label: "Bem-estar", metric: "Fundamentos do Bem-estar", sourceIds: ["ipsBrasilImazon"] },
        opportunity: { label: "Oportunidades", metric: "Oportunidades", sourceIds: ["ipsBrasilImazon"] }
      },
      note: "IPS Brasil 2026 (Imazon/Instituto IPS Brasil): 57 indicadores sociais e ambientais, sem indicadores econômicos, em escala 0-100. Dado oficial no Brasil, nas 27 UFs e nos 5.570 municípios."
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
      note: "No Globo, alterna entre homicídios (UNODC) e Global Peace Index. No Brasil e UFs, alterna entre MVI, roubos de veículos, feminicídio e violência doméstica (FBSP). Em municípios, MVI usa homicídios estimados do Atlas para 319 municípios com mais de 100 mil habitantes; quando ausente, usa proxy pela UF."
    },
    health: {
      label: "Saúde",
      caption: "Saúde e hospitais",
      icon: "heart-pulse",
      group: "primary",
      title: "Saúde, hospitais, leitos e acesso",
      defaultMetric: "bedsPer1000",
      metricStateKey: "healthSubMetric",
      sourceIds: ["healthGlobalWho", "healthBrazilDatasus", "healthBrazilCitiesDatasus", "healthBrazilCityProxy"],
      metrics: {
        bedsPer1000: { label: "Leitos", metric: "Leitos por 1.000 hab.", sourceIds: ["healthBrazilDatasus", "healthBrazilCitiesDatasus"] },
        icuBedsPer100k: { label: "UTI", metric: "Leitos UTI por 100k hab.", sourceIds: ["healthBrazilDatasus", "healthBrazilCitiesDatasus"] },
        doctorsPer1000: { label: "Medicos", metric: "Medicos por 1.000 hab.", sourceIds: ["healthBrazilDatasus", "healthBrazilCitiesDatasus"] },
        infantMortality: { label: "Mort. infantil", metric: "Mortalidade infantil por 1.000 NV", sourceIds: ["healthBrazilDatasus", "healthBrazilCitiesDatasus"] },
        vaccinationCoverage: { label: "Vacinacao", metric: "Cobertura vacinal (%)", sourceIds: ["healthBrazilDatasus", "healthBrazilCitiesDatasus"] },
        uhcIndex: { label: "UHC", metric: "Cobertura essencial UHC", sourceIds: ["healthGlobalWho", "healthGlobalWorldBank"] },
        lifeExpectancy: { label: "Expect. vida", metric: "Expectativa de vida", sourceIds: ["healthGlobalWho", "healthGlobalWorldBank"] },
        hospitalBedsPer10000: { label: "Leitos globais", metric: "Leitos por 10.000 hab.", sourceIds: ["healthGlobalWho", "healthGlobalWorldBank"] }
      },
      note: "No Globo, usa indicadores padronizados da OMS/Banco Mundial/IHME. No Brasil e UFs, usa base inicial DATASUS/CNES/SIM/SINASC/IBGE. Em municípios, usa dado municipal quando existir em health_brazil_cities.parquet; quando faltar, usa proxy pela UF."
    },
    sse: {
      label: "SSE",
      caption: "Saúde, Segurança, Educação",
      icon: "target",
      group: "primary",
      title: "Índice composto SSE: Saúde + Segurança + Educação",
      defaultMetric: "sseTotal",
      sourceIds: ["healthBrazilDatasus", "securityBrazilFBSP", "enemLocal"],
      note: "V1 simplificada: cada dimensao normalizada para 0-100 e o SSE total e a media simples (1/3 cada). Saude = media de leitos, medicos, vacinacao e (inverso de) mortalidade infantil. Seguranca = inverso da taxa de homicidios (MVI). Educacao = nota ENEM normalizada entre 450 e 650."
    },
    travel: {
      label: "Viajando o Brasil",
      caption: "Viajando o Brasil",
      icon: "map-pin",
      group: "explore",
      title: "Municípios e estados documentados em vídeo",
      defaultMetric: "documentedCities",
      sourceIds: ["travelCurated"],
      note: "Camada curada manualmente para municípios e estados com documentários em vídeo."
    },
    stories: {
      label: "Histórias dos Municípios",
      caption: "Histórias dos Municípios",
      icon: "book-open",
      group: "explore",
      title: "A leitura do lugar: por que o município existe e do que ele vive",
      defaultMetric: "storyScore",
      sourceIds: ["storiesAi"],
      note: "Piloto com 10 municípios: história curta gerada por IA apenas com dados do IBGE (população, PIB, VAB e histórico oficial), com arquétipo e nível de confiança."
    }
  };

  const ANALYSIS_EDITORIAL = {
    general: {
      kicker: "Atlas demográfico",
      title: "População e território",
      summary: "Compare população, área, densidade e posição relativa dos territórios."
    },
    gdp: {
      kicker: "Economia territorial",
      title: "PIB e riqueza",
      summary: "Explore o PIB total e por habitante, distinguindo valores oficiais e projeções sinalizadas."
    },
    hdi: {
      kicker: "Desenvolvimento humano",
      title: "IDH e IDHM",
      summary: "Compare desenvolvimento humano, série histórica e componentes disponíveis em cada escala."
    },
    ips: {
      kicker: "Progresso social",
      title: "Índice de Progresso Social",
      summary: "Analise resultados sociais e ambientais do IPS em escala de zero a cem."
    },
    politics: {
      kicker: "Representação pública",
      title: "Política e representação",
      summary: "Examine representação política, habitantes por representante e estimativas explicitamente identificadas."
    },
    education: {
      kicker: "Educação",
      title: "Formação e desempenho educacional",
      summary: "Compare os indicadores educacionais disponíveis e seus níveis de cobertura territorial."
    },
    security: {
      kicker: "Segurança pública",
      title: "Violência e segurança",
      summary: "Explore violência letal e outros indicadores de segurança, observando fonte, ano e cobertura."
    },
    health: {
      kicker: "Saúde pública",
      title: "Saúde, acesso e capacidade",
      summary: "Compare acesso, leitos, profissionais, vacinação e resultados de saúde disponíveis."
    },
    sse: {
      kicker: "Síntese territorial",
      title: "Saúde, Segurança e Educação",
      summary: "Leia conjuntamente as três dimensões do índice composto SSE e seus componentes."
    },
    travel: {
      kicker: "Atlas imersivo",
      title: "Viajando pelo Brasil",
      summary: "Descubra territórios documentados em vídeo e abra suas leituras locais."
    },
    stories: {
      kicker: "Histórias dos municípios",
      title: "A leitura do lugar",
      summary: "Entenda por que cada município existe e do que vive, com textos ancorados em dados oficiais."
    }
  };

  const WORLD_METRIC_CATALOG = {
    pop: { label: "População", metric: "População", sourceIds: ["localWorldJson"], labels: ["<1mi", "10mi", "50mi", "200mi", "1bi+"] },
    area: { label: "Área territorial", metric: "Área territorial", sourceIds: ["localWorldJson"], labels: ["Pequeno", "Médio", "Grande", "Gigante", "Continental"] },
    density: { label: "Densidade pop.", metric: "Densidade pop.", sourceIds: ["localWorldJson"], labels: ["<10", "50", "150", "500", "1000+"] },
    gdp: { label: "PIB", metric: "PIB US$ (2024)", sourceIds: ["localWorldJson"], labels: ["<10bi", "100bi", "500bi", "2tri", "10tri+"] },
    gdpPerCapita: { label: "PIB per capita", metric: "PIB per capita US$ (24)", sourceIds: ["localWorldJson"], labels: ["<2k", "5k", "15k", "35k", "60k+"] }
  };

  const STORAGE_KEY = "atlas-brasil-preferences-v3";
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
  let countryClickTimer = null;
  let hoverPopup = null;
  let hoveredFeatureKey = null;
  let isStreetMode = false;
  let brazilMeshFeature = null;
  let hoverCardsEnabled = savedPreferences.hoverCards !== false;
  let bubblesEnabled = savedPreferences.bubbles !== false;
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
  let healthGlobalData = null;
  let healthBrazilData = null;
  let healthBrazilCitiesData = null;
  let storiesBrazilCitiesData = null;
  let activeHealthSubMetric = savedPreferences.healthSubMetric || "bedsPer1000";
  let ipsBrazilData = null;
  let ipsBrazilCitiesData = null;
  let currentSectorData = null;
  let activeSectorIndicator = savedPreferences.sectorIndicator || "bairro";
  const ipsCitiesByYear = new Map();
  const ipsDerivedBreaks = new Map();
  let availableIpsYears = [];
  // "last" resolve para a edição vigente assim que o JSON carrega.
  let activeIpsYear = savedPreferences.ipsYear ? String(savedPreferences.ipsYear) : "2026";
  let activeIpsSubMetric = validAnalysisMetric("ips", savedPreferences.ipsSubMetric) ? savedPreferences.ipsSubMetric : "ipsGeral";
  let activeSourceSelections = { ...(savedPreferences.sourceSelections || {}) };
  let activeBaseMode = validBaseMode(savedPreferences.base) ? savedPreferences.base : "earth";
  let activeProjection = validProjection(savedPreferences.projection) ? savedPreferences.projection : "globe";
  let activeView = validView(savedPreferences.view) ? savedPreferences.view : "world";
  let activeAnalysis = validAnalysis(savedPreferences.analysis) ? savedPreferences.analysis : "general";
  let activeGdpSubMetric = savedPreferences.gdpSubMetric || "perCapita";
  let activeWorldMetric = validWorldMetric(savedPreferences.worldMetric) ? savedPreferences.worldMetric : "pop";
  let activeCurrency = savedPreferences.currency === "USD" ? "USD" : "BRL";
  const USD_BRL_RATE = 5.0;
  let basePaintByLayer = new Map();
  let worldFeatureCollection = null;
  let legendCollapsed = null;
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    renderAnalysisControls();
    updateEditorialHeader();
    if (window.lucide) window.lucide.createIcons();

    if (typeof maplibregl === "undefined") {
      showStatus("MapLibre não carregou", "Verifique se os arquivos locais de vendor foram publicados.", true);
      return;
    }

    initMap();
    bindControls();
    bindPanelHandle();
    applyPreferenceControls();
    loadAtlas().catch((error) => {
      console.error("Falha ao carregar os Parquets locais", error);
      if (window.location.protocol === "file:") {
        showStatus(
          "Abra o Atlas por HTTP",
          "Os Parquets não podem ser lidos por file://. Inicie o servidor local e acesse http://127.0.0.1:8000/.",
          true
        );
        return;
      }
      showStatus("Dados locais indisponíveis", "Confirme a publicação completa em data/parquet/site e recarregue o Atlas.", true);
    });
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 620px)").matches;
  }

  function bindPanelHandle() {
    const handle = document.getElementById("panel-handle");
    const panel = document.querySelector(".panel");
    if (!handle || !panel) return;

    const label = handle.querySelector(".panel-handle-label");
    const atPanel = () => panel.getBoundingClientRect().top <= 8;

    const sync = () => {
      const showingPanel = atPanel();
      handle.classList.toggle("at-panel", showingPanel);
      if (label) label.textContent = showingPanel ? "Voltar ao mapa" : "Deslize para ver os dados";
      handle.setAttribute("aria-label", showingPanel ? "Voltar ao mapa" : "Ver dados e análises");
    };

    handle.addEventListener("click", () => {
      if (atPanel()) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  }

  function cacheElements() {
    [
      "status", "status-spinner", "status-title", "status-text", "fixed-detail-card", "hud-layer", "hud-source", "hud-zoom", "hud-coords",
      "heat-legend",
      "brand-kicker", "brand-title", "brand-subtitle",
      "metric-br-pop", "metric-city-count", "metric-state", "metric-state-pop", "metric-city", "metric-city-pop",
      "analysis-caption", "data-state-label", "search", "search-results", "selected-code", "selected-type", "selected-name",
      "selected-pop", "selected-share", "selected-area", "selected-density", "selected-rank", "selected-context", "hover-cards-toggle", "bubbles-toggle", "population-chart", "chart-title",
      "chart-caption", "ranking", "ranking-title", "ranking-caption", "general-caption", "general-grid", "general-note",
      "analysis-primary-nav", "analysis-explore-nav", "sector-indicator-controls",
      "sector-indicator-select", "sector-indicator-note"
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
      center: savedCamera ? savedCamera.center : BR_CENTER,
      zoom: savedCamera ? savedCamera.zoom : 1.5,
      pitch: savedCamera ? savedCamera.pitch : 0,
      bearing: savedCamera ? savedCamera.bearing : 0,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (map.doubleClickZoom) map.doubleClickZoom.disable();

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
    showStatus("Carregando dados oficiais", "Lendo os Parquets locais do Atlas Brasil.");
    seedFallbackStates();
    const data = await globalThis.AtlasStaticData.loadInitial(STATE_FALLBACK, activeIpsYear);
    mergeStates(data.states);
    mergePopulation(data.statePopulation, stateById);
    totalPopulation = sumPopulation(Array.from(stateById.values()));
    mergeCities(data.cities);
    mergeCityPopulation(data.cityPopulation);
    mergeBrazilGdp(data.gdpBrazil);
    mergeGdp(data.gdpStates, stateById);
    mergeGdp(data.gdpCities, cityById);
    mergeGlobalHdi(data.hdiGlobal);
    mergeOwidHdi(data.hdiOwid);
    mergeBrazilHdi(data.idhmBrazil);
    mergeSecurityGlobal(data.securityGlobal);
    mergeSecurityBrazil(data.securityBrazil);
    mergeSecurityBrazilCities(data.securityBrazilCities);
    mergeHealthGlobal(data.healthGlobal);
    mergeHealthBrazil(data.healthBrazil);
    mergeHealthBrazilCities(data.healthBrazilCities);
    if (data.storiesBrazilCities && data.storiesBrazilCities.cities) {
      storiesBrazilCitiesData = data.storiesBrazilCities;
    }
    mergeIpsBrazil(data.ipsBrazil);
    mergeIpsBrazilCities(data.ipsBrazilCities);
    hydrateBrazilMesh(data.brazilMesh);
    hydrateStatesMesh(data.statesMesh);
    worldFeatureCollection = data.world;
    syncHdiToActiveYear();
    syncSecurityData();
    syncHealthData();
    syncIpsData();

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

    elements["data-state-label"].textContent = "Parquet local";

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
    updateEditorialHeader();
    showStatus(`Carregando ${state.sigla}`, "Montando malha de municípios e bolhas proporcionais de população.");

    try {
      if (!stateCitiesCache.has(selectedStateId)) {
        const mesh = await globalThis.AtlasStaticData.loadMunicipalities(state.sigla);
        const collection = hydrateCityMesh(mesh, selectedStateId);
        stateCitiesCache.set(selectedStateId, collection);
        syncGdpToActiveYear();
      }

      const collection = stateCitiesCache.get(selectedStateId);
      updateMunicipalitySources(collection);
      renderMunicipalityRanking(collection);
      renderMunicipalityChart(collection);
      setLayerVisibility("municipality", true);
      elements["hud-layer"].textContent = "Municípios";

      const selectedFeature = collection.features.find((feature) => feature.properties.id === String(requestedCityId));
      enterCityAnalysisMode();
      if (selectedFeature) {
        selectCity(selectedFeature.properties.id, selectedFeature, { fly: options.preserveCamera ? false : true });
      } else if (!options.preserveCamera) {
        flyToState(state);
      }
    } catch (error) {
      console.warn("Falha ao carregar municípios", error);
      updateMunicipalitySources(emptyFeatureCollection());
      renderEmptyRanking("Não foi possível carregar a malha de municípios dessa UF agora.");
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

  function mergeIpsBrazil(data) {
    if (!data || !data.states) return;
    ipsBrazilData = data;

    availableIpsYears = (data.editions || data.years || [])
      .map((year) => String(year))
      .sort((a, b) => Number(b) - Number(a));

    if (!availableIpsYears.includes(activeIpsYear)) {
      activeIpsYear = String(data.latestYear || data.edition || availableIpsYears[0] || "");
    }

    syncIpsToActiveYear();
  }

  function mergeIpsBrazilCities(data) {
    if (!data || !data.cities) return;
    const year = String(data.edition || data.latestYear || activeIpsYear);
    ipsCitiesByYear.set(year, data);
    if (year === activeIpsYear) ipsBrazilCitiesData = data;
    syncIpsToActiveYear();
  }

  /** Busca a base municipal de um ano sob demanda (só a edição vigente vem no load). */
  async function ensureIpsYearLoaded(year) {
    const key = String(year);
    if (ipsCitiesByYear.has(key)) return ipsCitiesByYear.get(key);
    try {
      const data = await globalThis.AtlasStaticData.loadIpsYear(key);
      if (data && data.cities) {
        ipsCitiesByYear.set(key, data);
        return data;
      }
    } catch (error) {
      console.warn(`Falha ao carregar IPS municipal de ${key}.`, error);
    }
    return null;
  }

  function syncIpsToActiveYear() {
    if (!ipsBrazilData) return;
    const year = String(activeIpsYear);

    Object.entries(ipsBrazilData.states || {}).forEach(([stateId, row]) => {
      const state = stateById.get(String(stateId));
      if (!state) return;
      const entry = (row.byYear || {})[year] || {};
      state.ips = entry.ips || 0;
      state.ipsRank = entry.rank || 0;
      state.ipsDimensions = entry.dimensions || null;
      state.ipsYear = year;
    });

    ipsBrazilCitiesData = ipsCitiesByYear.get(year) || null;
    ipsDerivedBreaks.clear();
    const cityRows = ipsBrazilCitiesData ? ipsBrazilCitiesData.cities : null;
    cityById.forEach((city) => {
      const row = cityRows ? cityRows[String(city.id)] : null;
      city.ips = row ? (row.ips || 0) : 0;
      city.ipsRank = row ? (row.rank || 0) : 0;
      city.ipsDimensions = row ? (row.dimensions || null) : null;
      city.ipsYear = year;
      city.ipsReal = Boolean(row);
    });

    syncIpsData();
  }

  function ipsBrazilForYear(year) {
    if (!ipsBrazilData || !ipsBrazilData.brazil) return null;
    const key = String(year || activeIpsYear);
    const byYear = ipsBrazilData.brazil.byYear || {};
    return byYear[key] || null;
  }

  function isLatestIpsYear() {
    if (!ipsBrazilData) return true;
    return String(activeIpsYear) === String(ipsBrazilData.latestYear || ipsBrazilData.edition || activeIpsYear);
  }

  /** Dimensão da cidade; se faltar, cai na da UF (mesmo fallback do IPS geral). */
  function ipsDimensionValue(cityRow, state, key) {
    if (cityRow && cityRow.dimensions) return cityRow.dimensions[key] || 0;
    if (state && state.ipsDimensions) return state.ipsDimensions[key] || 0;
    return 0;
  }

  function ipsCityRow(cityId) {
    if (!ipsBrazilCitiesData || !ipsBrazilCitiesData.cities) return null;
    return ipsBrazilCitiesData.cities[String(cityId)] || null;
  }

  function ipsCityCount() {
    return ipsBrazilCitiesData ? (ipsBrazilCitiesData.count || Object.keys(ipsBrazilCitiesData.cities || {}).length) : 0;
  }

  function syncIpsData() {
    if (!ipsBrazilData && !ipsBrazilCitiesData) return;

    if (brazilMeshFeature && ipsBrazilData) {
      const brazilYear = ipsBrazilForYear(activeIpsYear);
      brazilMeshFeature.properties.ips = (brazilYear && brazilYear.ips) || 0;
      brazilMeshFeature.properties.ipsYear = ipsEdition();
    }

    stateCitiesCache.forEach((collection, cachedStateId) => {
      const state = stateById.get(String(cachedStateId));
      collection.features.forEach((feature) => {
        feature.properties = { ...feature.properties, ...cityMapProperties(feature.properties) };
        if (!feature.properties.ips && state) {
          feature.properties.ips = state.ips || 0;
          feature.properties.ipsProxy = true;
        }
      });
      if (selectedStateId && String(selectedStateId) === String(cachedStateId)) {
        updateMunicipalitySources(collection);
      }
    });
  }

  // ipsSubMetric -> campo achatado nas properties do mapa (MapLibre lê melhor
  // propriedade simples que objeto aninhado).
  const IPS_METRIC_FIELDS = {
    ipsGeral: "ips",
    basicNeeds: "ipsBasicNeeds",
    wellbeing: "ipsWellbeing",
    opportunity: "ipsOpportunity"
  };

  function ipsMetricField() {
    return IPS_METRIC_FIELDS[activeIpsSubMetric] || "ips";
  }

  /** Chave do indicador ativo dentro de classBreaks/dimensions do JSON. */
  function ipsMetricKey() {
    return IPS_METRIC_FIELDS[activeIpsSubMetric] ? activeIpsSubMetric : "ipsGeral";
  }

  function ipsClassBreaks() {
    const key = ipsMetricKey();
    const catalog = (ipsBrazilData && ipsBrazilData.classBreaks) || {};
    const entry = catalog[key === "ipsGeral" ? "ips" : key];
    if (entry && Array.isArray(entry.breaks) && entry.breaks.length) return entry.breaks;

    // JSON antigo em cache não traz classBreaks. Usar os cortes do IPS geral numa
    // dimensão achataria o mapa (Necessidades vive perto de 75, Oportunidades de 44),
    // então derivamos os cortes do próprio dado carregado.
    const derived = deriveIpsBreaks(key);
    return derived.length ? derived : IPS_FALLBACK_BREAKS;
  }

  /** Cortes por quantis calculados do dado em memória (fallback auto-corretivo). */
  function deriveIpsBreaks(key) {
    const cached = ipsDerivedBreaks.get(key);
    if (cached) return cached;

    const values = [];
    const collect = (row) => {
      const value = ipsValueOf(row);
      if (Number.isFinite(value) && value > 0) values.push(value);
    };
    if (ipsBrazilCitiesData && ipsBrazilCitiesData.cities) {
      Object.values(ipsBrazilCitiesData.cities).forEach(collect);
    } else if (ipsBrazilData && ipsBrazilData.states) {
      Object.values(ipsBrazilData.states).forEach((row) => collect((row.byYear || {})[String(activeIpsYear)]));
    }
    if (values.length < IPS_CLASS_COLORS.length) return [];

    values.sort((a, b) => a - b);
    const breaks = [];
    for (let index = 1; index < IPS_CLASS_COLORS.length; index++) {
      const position = Math.round((index / IPS_CLASS_COLORS.length) * (values.length - 1));
      const value = Number(values[position].toFixed(2));
      breaks.push(index > 0 && breaks.length && value <= breaks[breaks.length - 1]
        ? Number((breaks[breaks.length - 1] + 0.01).toFixed(2))
        : value);
    }
    ipsDerivedBreaks.set(key, breaks);
    return breaks;
  }

  /** Valor do indicador ativo em um registro com {ips, dimensions:{...}}. */
  function ipsValueOf(row) {
    if (!row) return 0;
    const key = ipsMetricKey();
    if (key === "ipsGeral") return row.ips || 0;
    return (row.dimensions && row.dimensions[key]) || 0;
  }

  function ipsEdition() {
    if (!ipsBrazilData) return String(activeIpsYear || "");
    return String(activeIpsYear || ipsBrazilData.latestYear || ipsBrazilData.edition || "");
  }

  function formatIps(value) {
    const numeric = Number(value) || 0;
    return numeric > 0 ? numeric.toFixed(2).replace(".", ",") : "sem dado";
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

  function mergeHealthGlobal(data) {
    if (!data || !data.countries) return;
    healthGlobalData = data;
    if (worldFeatureCollection) {
      hydrateWorldHealth(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function mergeHealthBrazil(data) {
    if (!data || !data.states) return;
    healthBrazilData = data;
    Object.entries(data.states || {}).forEach(([uf, row]) => {
      const state = Array.from(stateById.values()).find((s) => s.sigla === uf);
      if (!state) return;
      applyHealthRow(state, row);
    });
    syncHealthData();
  }

  function mergeHealthBrazilCities(data) {
    if (!data || !data.cities) return;
    healthBrazilCitiesData = data;
    syncHealthData();
  }

  function applyHealthRow(target, row) {
    target.bedsPer1000 = row.bedsPer1000 || 0;
    target.susBedsPer1000 = row.susBedsPer1000 || 0;
    target.icuBedsPer100k = row.icuBedsPer100k || 0;
    target.doctorsPer1000 = row.doctorsPer1000 || 0;
    target.nursesPer1000 = row.nursesPer1000 || 0;
    target.infantMortality = row.infantMortality || 0;
    target.maternalMortality = row.maternalMortality || 0;
    target.vaccinationCoverage = row.vaccinationCoverage || 0;
    target.privateCoverage = row.privateCoverage || 0;
    target.healthYear = row.year || 2023;
    target.healthSource = row.source || target.healthSource || "";
  }

  function syncHealthData() {
    if (!healthBrazilData && !healthGlobalData && !healthBrazilCitiesData) return;
    if (healthBrazilData && brazilMeshFeature) {
      applyHealthRow(brazilMeshFeature.properties, healthBrazilData.brazil || {});
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
      hydrateWorldHealth(worldFeatureCollection);
      setSourceData("world-fill-source", worldFeatureCollection);
    }
  }

  function hydrateWorldHealth(collection) {
    if (!collection || !healthGlobalData || !healthGlobalData.countries) return collection;
    collection.features.forEach((feature) => {
      const props = feature.properties || {};
      const iso3 = props.ISO_A3 || props.ADM0_A3 || props.iso3 || props.ISO3;
      const row = healthGlobalData.countries[iso3];
      if (!row) return;
      feature.properties = {
        ...props,
        lifeExpectancy: row.lifeExpectancy || 0,
        healthyLifeExpectancy: row.healthyLifeExpectancy || 0,
        uhcIndex: row.uhcIndex || 0,
        hospitalBedsPer10000: row.hospitalBedsPer10000 || 0,
        physiciansPer10000: row.physiciansPer10000 || 0,
        nursesMidwivesPer10000: row.nursesMidwivesPer10000 || 0,
        healthExpPctGdp: row.healthExpPctGdp || 0,
        outOfPocketPct: row.outOfPocketPct || 0,
        healthYear: row.year || 2022,
        healthSource: row.source || "WHO/WDI/IHME"
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
        name: city.nome || readGeoProperty(feature.properties, ["nomarea", "NM_MUN", "nome"]) || `Município ${id}`,
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
    const enemScore = (ENEM_HISTORY_SCORES[activeEnemYear] || {})[state.sigla] || 0;
    const scores = sseScores({
      bedsPer1000: state.bedsPer1000,
      doctorsPer1000: state.doctorsPer1000,
      vaccinationCoverage: state.vaccinationCoverage,
      infantMortality: state.infantMortality,
      mviRate: state.mviRate,
      enemScore: enemScore,
    });
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
      ips: state.ips || 0,
      ipsRank: state.ipsRank || 0,
      ipsBasicNeeds: (state.ipsDimensions && state.ipsDimensions.basicNeeds) || 0,
      ipsWellbeing: (state.ipsDimensions && state.ipsDimensions.wellbeing) || 0,
      ipsOpportunity: (state.ipsDimensions && state.ipsDimensions.opportunity) || 0,
      ipsDimensions: state.ipsDimensions || null,
      ipsYear: state.ipsYear || ipsEdition(),
      ipsProxy: false,
      mviRate: state.mviRate || 0,
      vehicleTheftRate: state.vehicleTheftRate || 0,
      femicideRate: state.femicideRate || 0,
      domesticViolenceRate: state.domesticViolenceRate || 0,
      mvi: state.mvi || 0,
      securityYear: state.securityYear || 2023,
      bedsPer1000: state.bedsPer1000 || 0,
      susBedsPer1000: state.susBedsPer1000 || 0,
      icuBedsPer100k: state.icuBedsPer100k || 0,
      doctorsPer1000: state.doctorsPer1000 || 0,
      nursesPer1000: state.nursesPer1000 || 0,
      infantMortality: state.infantMortality || 0,
      maternalMortality: state.maternalMortality || 0,
      vaccinationCoverage: state.vaccinationCoverage || 0,
      privateCoverage: state.privateCoverage || 0,
      healthYear: state.healthYear || 2023,
      healthProxy: false,
      politicsTotal: politics.total,
      peoplePerPolitician: inhabitantsPerPolitician(state.pop, politics.total),
      stateDeputies: politics.stateDeputies,
      federalDeputies: politics.federalDeputies,
      mayors: politics.mayors,
      councilorsMax: politics.councilorsMax,
      enemScore: enemScore,
      sseTotal: scores.sseTotal,
      saudeScore: scores.saudeScore,
      segurancaScore: scores.segurancaScore,
      educacaoScore: scores.educacaoScore,
      travelScore: Object.keys(DOCUMENTED_CITIES).some(id => id.startsWith(state.id)) ? 1 : 0,
      storyScore: storyCityIds().some(id => id.startsWith(state.id)) ? 1 : 0,
      lng: state.lng,
      lat: state.lat
    };
  }

  function storyForCity(cityId) {
    if (!storiesBrazilCitiesData || !storiesBrazilCitiesData.cities) return null;
    return storiesBrazilCitiesData.cities[String(cityId)] || null;
  }

  function storyCityIds() {
    if (!storiesBrazilCitiesData || !storiesBrazilCitiesData.cities) return [];
    return Object.keys(storiesBrazilCitiesData.cities);
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
    const cityIps = ipsCityRow(props.id);
    const cityHealthData = healthBrazilCitiesData && healthBrazilCitiesData.cities ? healthBrazilCitiesData.cities[String(props.id)] : null;
    const hasCityHealthData = !!cityHealthData && !cityHealthData.proxy;
    const healthBase = cityHealthData || state || {};
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
      // IPS municipal oficial dos 5.570 municípios; só cai no proxy da UF se faltar.
      ips: cityIps ? (cityIps.ips || 0) : (state ? (state.ips || 0) : 0),
      ipsRank: cityIps ? (cityIps.rank || 0) : 0,
      ipsDimensions: cityIps ? (cityIps.dimensions || null) : (state ? (state.ipsDimensions || null) : null),
      ipsBasicNeeds: ipsDimensionValue(cityIps, state, "basicNeeds"),
      ipsWellbeing: ipsDimensionValue(cityIps, state, "wellbeing"),
      ipsOpportunity: ipsDimensionValue(cityIps, state, "opportunity"),
      ipsStateRank: state ? (state.ipsRank || 0) : 0,
      ipsStateValue: state ? (state.ips || 0) : 0,
      ipsYear: cityIps ? (ipsBrazilCitiesData.edition || ipsEdition()) : (state ? (state.ipsYear || ipsEdition()) : ipsEdition()),
      ipsReal: Boolean(cityIps),
      ipsProxy: !cityIps,
      // Security: use IPEA real data for homicide/MVI when available, fallback to state proxy
      mviRate: hasRealData ? cityHomicideRate : (state ? (state.mviRate || 0) : 0),
      homicideRate: hasRealData ? cityHomicideRate : 0,
      estimatedHomicides: hasRealData ? (cityRealData.estimatedHomicides || 0) : 0,
      registeredHomicides: hasRealData ? (cityRealData.registeredHomicides || 0) : 0,
      hiddenHomicides: hasRealData ? (cityRealData.hiddenHomicides || 0) : 0,
      securityRank: hasRealData ? (cityRealData.rank || 0) : 0,
      securityPopulation2022: hasRealData ? (cityRealData.population2022 || 0) : 0,
      vehicleTheftRate: state ? (state.vehicleTheftRate || 0) : 0,
      femicideRate: state ? (state.femicideRate || 0) : 0,
      domesticViolenceRate: state ? (state.domesticViolenceRate || 0) : 0,
      mvi: state ? (state.mvi || 0) : 0,
      securityYear: citySecurityYear,
      securityReal: hasRealData,
      bedsPer1000: healthBase.bedsPer1000 || 0,
      susBedsPer1000: healthBase.susBedsPer1000 || 0,
      icuBedsPer100k: healthBase.icuBedsPer100k || 0,
      doctorsPer1000: healthBase.doctorsPer1000 || 0,
      nursesPer1000: healthBase.nursesPer1000 || 0,
      infantMortality: healthBase.infantMortality || 0,
      maternalMortality: healthBase.maternalMortality || 0,
      vaccinationCoverage: healthBase.vaccinationCoverage || 0,
      privateCoverage: healthBase.privateCoverage || 0,
      healthYear: healthBase.year || healthBase.healthYear || 2023,
      healthReal: hasCityHealthData,
      healthProxy: !hasCityHealthData,
      healthCoverage: cityHealthData ? (cityHealthData.coverage || "uf_proxy") : "uf_proxy",
      healthRealFields: cityHealthData ? (cityHealthData.realFields || []) : [],
      healthSource: hasCityHealthData ? (cityHealthData.source || "CNES/SIM/SINASC/SI-PNI/IBGE") : (healthBase.source || "Proxy UF"),
      enemScore: baseScore > 0 ? parseFloat((baseScore + cityEnemVariation).toFixed(1)) : 0,
      travelScore: DOCUMENTED_CITIES[props.id] ? 1 : 0,
      storyScore: storyForCity(props.id) ? 1 : 0,
      ...sseScores({
        bedsPer1000: healthBase.bedsPer1000 || 0,
        doctorsPer1000: healthBase.doctorsPer1000 || 0,
        vaccinationCoverage: healthBase.vaccinationCoverage || 0,
        infantMortality: healthBase.infantMortality || 0,
        mviRate: hasRealData ? cityHomicideRate : (state ? (state.mviRate || 0) : 0),
        enemScore: baseScore > 0 ? parseFloat((baseScore + cityEnemVariation).toFixed(1)) : 0,
      })
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
        "circle-radius": ["interpolate", ["exponential", 0.5], ["to-number", ["get", "pop"], 0], 600000, 5, 3000000, 9, 9000000, 15, 44000000, 28],
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
        "circle-radius": ["interpolate", ["exponential", 0.5], ["to-number", ["get", "pop"], 0], 1000, 3, 10000, 5, 100000, 8, 500000, 13, 2000000, 22, 11000000, 36],
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
    // O IPS é coroplético classificado: com 0.58 sobre o basemap híbrido as classes
    // lavam e o mapa volta a parecer homogêneo. Sobe a opacidade só nessa análise.
    const isChoropleth = activeAnalysis === "ips";
    setLayerPaint("states-fill", {
      "fill-color": territoryHeatColorExpression("state"),
      "fill-opacity": isChoropleth ? 0.86 : 0.58
    });
    setLayerPaint("states-bubbles", {
      "circle-color": isChoropleth ? territoryHeatColorExpression("state") : analysisBubbleColor(),
      "circle-radius": territoryBubbleRadiusExpression("state"),
      "circle-opacity": 0.74
    });
    setLayerPaint("municipality-fill", {
      "fill-color": territoryHeatColorExpression("city"),
      "fill-opacity": isChoropleth ? 0.82 : 0.5
    });
    setLayerPaint("municipality-bubbles", {
      "circle-color": isChoropleth ? territoryHeatColorExpression("city") : analysisBubbleColor(),
      "circle-radius": territoryBubbleRadiusExpression("city"),
      "circle-opacity": 0.72,
      "circle-stroke-width": (activeAnalysis === "travel" || activeAnalysis === "stories") ? 2.2 : 1.4,
      "circle-stroke-color": (activeAnalysis === "travel" || activeAnalysis === "stories") ? "#ffffff" : "#0b1014"
    });
    applyBaseModeToAtlasLayers();
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
    } else if (metricType === "ips") {
       // A escala do IPS é fixa (0-100) e igual em UF e cidade, para a cor significar
       // sempre a mesma coisa. Sem escala relativa aqui, de propósito.
       return null;
    } else if (metricType === "politics") {
       values = collection.features.map(f => inhabitantsPerPolitician(f.properties.pop, cityPoliticalSummary(f.properties).total));
    } else if (metricType === "education") {
       values = collection.features.map(f => f.properties.enemScore || 0);
    } else if (metricType === "travel") {
       values = collection.features.map(f => f.properties.travelScore || 0);
    } else if (metricType === "stories") {
       values = collection.features.map(f => f.properties.storyScore || 0);
    } else if (metricType === "security") {
       const metricMap = {
         mviRate: "mviRate",
         vehicleTheftRate: "vehicleTheftRate",
         femicideRate: "femicideRate",
         domesticViolenceRate: "domesticViolenceRate"
       };
       const field = metricMap[activeSecuritySubMetric] || "mviRate";
       values = collection.features.map(f => f.properties[field] || 0);
    } else if (metricType === "health") {
       const field = healthMetricField();
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

    if (activeAnalysis === "ips") {
      // Mapa classificado (step), como o oficial: sem cor intermediária embarrada.
      const breaks = ipsClassBreaks();
      const expression = ["step", metric, IPS_CLASS_COLORS[0]];
      breaks.forEach((value, index) => {
        expression.push(value, IPS_CLASS_COLORS[index + 1] || IPS_CLASS_COLORS[IPS_CLASS_COLORS.length - 1]);
      });
      return expression;
    }

    if (activeAnalysis === "gdp") {
      colors = ["#ff3b3b", "#ef7d60", "#f2c14e", "#79a95d", "#17212b"];
      if (!scale || scale.max <= scale.min) {
        if (activeGdpSubMetric === "total") {
          stops = isCity ? [0, 100e6, 500e6, 2e9, 10e9] : [0, 15e9, 50e9, 150e9, 400e9];
        } else {
          stops = isCity ? [0, 20000, 45000, 90000, 200000] : [0, 20000, 45000, 90000, 150000];
        }
      }
    } else if (activeAnalysis === "hdi") {
      colors = ["#ff3b3b", "#ef7d60", "#f2c14e", "#a9d65c", "#17212b"];
      if (!scale || scale.max <= scale.min) stops = [0.45, 0.6, 0.7, 0.8, 0.9];
    } else if (activeAnalysis === "politics") {
      colors = ["#ff3b3b", "#ef7d60", "#f2c14e", "#51d1c2", "#16212b"];
      if (!scale || scale.max <= scale.min) stops = isCity ? [0, 1500, 6000, 25000, 180000] : [0, 1500, 3000, 5000, 8000];
    } else if (activeAnalysis === "education") {
      colors = ["#5c1514", "#ef7d60", "#f2c14e", "#a9d65c", "#51d1c2", "#3a8fc7"];
      if (!scale || scale.max <= scale.min) stops = [509, 520, 530, 542, 556, 569];
    } else if (activeAnalysis === "travel") {
      colors = ["#17212b", "#f2c14e"];
      stops = [0, 1];
      scale = null; // force fixed stops for travel
    } else if (activeAnalysis === "stories") {
      colors = ["#17212b", "#b78ae8"];
      stops = [0, 1];
      scale = null; // force fixed stops for stories
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
    } else if (activeAnalysis === "sse") {
      // 0-100 score: red (low) -> green (high). Fixed stops; ignore scale.
      colors = ["#ef7d60", "#f2c14e", "#a9d65c", "#4f8f70", "#1a5f8a"];
      stops = [20, 40, 60, 80, 95];
      scale = null;
    } else if (activeAnalysis === "health") {
      const metric = activeHealthSubMetric || "bedsPer1000";
      const isNegative = metric === "infantMortality" || metric === "maternalMortality" || metric === "outOfPocketPct";
      colors = isNegative
        ? ["#1a5f8a", "#4f8f70", "#a9d65c", "#f2c14e", "#ff3b3b"]
        : ["#ff3b3b", "#ef7d60", "#f2c14e", "#a9d65c", "#17212b"];
      if (!scale || scale.max <= scale.min) {
        const metricStops = {
          bedsPer1000: [0.8, 1.4, 2.0, 2.6, 3.2],
          icuBedsPer100k: [8, 14, 20, 26, 34],
          doctorsPer1000: activeView === "world" ? [5, 15, 25, 40, 55] : [0.8, 1.5, 2.2, 3.0, 4.5],
          infantMortality: [8, 10, 12, 15, 18],
          vaccinationCoverage: [70, 78, 84, 88, 92],
          uhcIndex: [40, 60, 75, 85, 92],
          lifeExpectancy: [55, 65, 72, 78, 84],
          hospitalBedsPer10000: [5, 15, 30, 60, 100]
        };
        stops = metricStops[metric] || metricStops.bedsPer1000;
      }
    } else {
      colors = isCity
        ? ["#ff3b3b", "#ef7d60", "#f2c14e", "#5b8e54", "#25534e", "#17212b"]
        : ["#ff3b3b", "#ef7d60", "#f2c14e", "#5b8e54", "#17212b"];
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
      return ["interpolate", ["exponential", 0.5], metric, 0, 3, 20000, 6, 50000, 11, 100000, 18, 180000, 28];
    }
    if (activeAnalysis === "hdi") {
      return scope === "city"
        ? ["interpolate", ["linear"], metric, 0.45, 3, 0.7, 8, 0.8, 13, 0.9, 20]
        : ["interpolate", ["linear"], metric, 0.45, 5, 0.7, 10, 0.8, 16, 0.9, 24];
    }
    if (activeAnalysis === "ips") {
      // Raio acompanha os mesmos cortes do indicador ativo, para bolha e cor contarem
      // a mesma história (as dimensões vivem em faixas bem diferentes do IPS geral).
      const breaks = ipsClassBreaks();
      const low = breaks[0];
      const high = breaks[breaks.length - 1];
      return scope === "city"
        ? ["interpolate", ["linear"], metric, low, 3, (low + high) / 2, 9, high, 18]
        : ["interpolate", ["linear"], metric, low, 5, (low + high) / 2, 13, high, 24];
    }
    if (activeAnalysis === "politics") {
      return scope === "city"
        ? ["interpolate", ["exponential", 0.5], metric, 100, 3, 2000, 7, 8000, 12, 30000, 20, 200000, 34]
        : ["interpolate", ["exponential", 0.5], metric, 1000, 5, 3000, 10, 5000, 15, 8000, 22, 12000, 30];
    }
    if (activeAnalysis === "education") {
      return scope === "city"
        ? ["interpolate", ["linear"], metric, 509, 3, 540, 5, 569, 7]
        : ["interpolate", ["linear"], metric, 509, 5, 540, 10, 569, 16];
    }
    if (activeAnalysis === "sse") {
      return scope === "city"
        ? ["interpolate", ["linear"], metric, 0, 3, 50, 8, 80, 14, 100, 20]
        : ["interpolate", ["linear"], metric, 0, 5, 50, 12, 80, 20, 100, 30];
    }
    if (activeAnalysis === "travel") {
      return ["interpolate", ["linear"], metric, 0, 0, 1, 15];
    }
    if (activeAnalysis === "stories") {
      return ["interpolate", ["linear"], metric, 0, 0, 1, 15];
    }
    if (activeAnalysis === "security") {
      if (activeView === "world") {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          return ["interpolate", ["linear"], metric, 1.0, 3, 1.5, 6, 2.0, 10, 2.5, 14, 3.0, 20, 3.5, 28];
        }
        return ["interpolate", ["exponential", 0.5], metric, 0, 3, 5, 6, 15, 11, 30, 18, 50, 28];
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
          ? ["interpolate", ["exponential", 0.5], metric, 0, 3, 10, 6, 25, 11, 40, 18, 60, 28]
          : ["interpolate", ["exponential", 0.5], metric, 0, 5, 10, 10, 20, 16, 35, 24, 55, 34];
      }
      const expr = ["interpolate", ["exponential", 0.5], metric];
      for (let i = 0; i < stops.length; i += 2) {
        expr.push(stops[i], stops[i + 1]);
      }
      return expr;
    }
    if (activeAnalysis === "health") {
      if (activeView === "world") {
        const healthMetric = activeHealthSubMetric || "uhcIndex";
        if (healthMetric === "lifeExpectancy") return ["interpolate", ["linear"], metric, 55, 3, 65, 7, 72, 12, 78, 20, 84, 30];
        if (healthMetric === "hospitalBedsPer10000") return ["interpolate", ["exponential", 0.5], metric, 0, 3, 15, 7, 30, 12, 60, 20, 100, 30];
        if (healthMetric === "doctorsPer1000") return ["interpolate", ["linear"], metric, 5, 3, 15, 7, 25, 12, 40, 20, 55, 30];
        return ["interpolate", ["linear"], metric, 40, 3, 60, 7, 75, 12, 85, 20, 92, 30];
      }
      const healthMetric = activeHealthSubMetric || "bedsPer1000";
      const stops = {
        bedsPer1000: [0.8, 5, 1.4, 10, 2.0, 16, 2.6, 24, 3.2, 34],
        icuBedsPer100k: [8, 5, 14, 10, 20, 16, 26, 24, 34, 34],
        doctorsPer1000: [0.8, 5, 1.5, 10, 2.2, 16, 3.0, 24, 4.5, 34],
        infantMortality: [8, 5, 10, 10, 12, 16, 15, 24, 18, 34],
        vaccinationCoverage: [70, 5, 78, 10, 84, 16, 88, 24, 92, 34]
      }[healthMetric] || [0.8, 5, 1.4, 10, 2.0, 16, 2.6, 24, 3.2, 34];
      const expr = ["interpolate", ["exponential", 0.5], metric];
      for (let i = 0; i < stops.length; i += 2) expr.push(stops[i], stops[i + 1]);
      return expr;
    }
    return scope === "city"
      ? ["interpolate", ["exponential", 0.5], metric, 1000, 3, 10000, 5, 100000, 8, 500000, 13, 2000000, 22, 11000000, 36]
      : ["interpolate", ["exponential", 0.5], metric, 600000, 5, 3000000, 9, 9000000, 15, 44000000, 28];
  }

  function analysisMetricExpression() {
    if (activeAnalysis === "gdp") {
       return activeGdpSubMetric === "total" ? ["to-number", ["get", "gdp"], 0] : ["to-number", ["get", "gdpPerCapita"], 0];
    }
    if (activeAnalysis === "hdi") return ["to-number", ["get", "hdi"], 0];
    if (activeAnalysis === "ips") return ["to-number", ["get", ipsMetricField()], 0];
    if (activeAnalysis === "politics") return ["to-number", ["get", "peoplePerPolitician"], 0];
    if (activeAnalysis === "education") return ["to-number", ["get", "enemScore"], 0];
    if (activeAnalysis === "travel") return ["to-number", ["get", "travelScore"], 0];
    if (activeAnalysis === "stories") return ["to-number", ["get", "storyScore"], 0];
    if (activeAnalysis === "health") return ["to-number", ["get", healthMetricField()], 0];
    if (activeAnalysis === "sse") return ["to-number", ["get", "sseTotal"], 0];
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
    if (activeAnalysis === "ips") return "#4f9bd9";
    if (activeAnalysis === "politics") return "#51d1c2";
    if (activeAnalysis === "education") return "#b8e8e0";
    if (activeAnalysis === "travel") return "#f2c14e";
    if (activeAnalysis === "stories") return "#b78ae8";
    if (activeAnalysis === "security") return "#ef7d60";
    if (activeAnalysis === "health") return "#51d1c2";
    if (activeAnalysis === "sse") return "#a9d65c";
    return "#51d1c2";
  }

  function brazilAnalysisColor() {
    if (activeAnalysis === "gdp") return "#f2c14e";
    if (activeAnalysis === "hdi") return "#a9d65c";
    if (activeAnalysis === "ips") return "#4f9bd9";
    if (activeAnalysis === "politics") return "#51d1c2";
    if (activeAnalysis === "education") return "#1a5f8a";
    if (activeAnalysis === "travel") return "#f2c14e";
    if (activeAnalysis === "stories") return "#b78ae8";
    if (activeAnalysis === "security") return "#ef7d60";
    if (activeAnalysis === "sse") return "#a9d65c";
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

  function clamp01to100(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
  }

  function sseScores(row) {
    // V1: each dimension normalized to 0-100 from a single or few indicators.
    // Saude: simple average of bedsPer1000 (cap 4), doctorsPer1000 (cap 4),
    // vaccinationCoverage (already 0-100), and inverse infantMortality (0 deaths=100, 20+=0).
    const beds = clamp01to100((Number(row.bedsPer1000) || 0) / 4 * 100);
    const docs = clamp01to100((Number(row.doctorsPer1000) || 0) / 4 * 100);
    const vacc = clamp01to100(Number(row.vaccinationCoverage) || 0);
    const infMort = Number(row.infantMortality) || 0;
    const infInv = clamp01to100(100 - infMort * 5);
    const healthCount = [beds, docs, vacc, infInv].filter((v) => v > 0).length || 1;
    const saude = (beds + docs + vacc + infInv) / healthCount;

    // Seguranca: inverse MVI (homicidios / 100k). 0 = 100, 50+ = 0.
    const mvi = Number(row.mviRate) || 0;
    const seguranca = clamp01to100(100 - mvi * 2);

    // Educacao: ENEM scaled. 450 = 0, 650 = 100.
    const enem = Number(row.enemScore) || 0;
    const educacao = enem > 0 ? clamp01to100((enem - 450) / 200 * 100) : 0;

    const dims = [saude, seguranca, educacao].filter((v) => v > 0);
    const total = dims.length ? dims.reduce((a, b) => a + b, 0) / dims.length : 0;

    return {
      sseTotal: Number(total.toFixed(1)),
      saudeScore: Number(saude.toFixed(1)),
      segurancaScore: Number(seguranca.toFixed(1)),
      educacaoScore: Number(educacao.toFixed(1)),
    };
  }

  function healthMetricField() {
    const metric = activeHealthSubMetric || "bedsPer1000";
    if (activeView === "world") {
      const worldMap = {
        uhcIndex: "uhcIndex",
        lifeExpectancy: "lifeExpectancy",
        hospitalBedsPer10000: "hospitalBedsPer10000",
        doctorsPer1000: "physiciansPer10000",
        bedsPer1000: "hospitalBedsPer10000",
        icuBedsPer100k: "hospitalBedsPer10000",
        vaccinationCoverage: "uhcIndex"
      };
      return worldMap[metric] || "uhcIndex";
    }
    return {
      bedsPer1000: "bedsPer1000",
      icuBedsPer100k: "icuBedsPer100k",
      doctorsPer1000: "doctorsPer1000",
      infantMortality: "infantMortality",
      vaccinationCoverage: "vaccinationCoverage"
    }[metric] || "bedsPer1000";
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
    if (activeAnalysis === "health") {
      if (activeView === "world") return ["healthGlobalWho", "healthGlobalWorldBank"];
      if (activeView === "cities") return ["healthBrazilCitiesDatasus", "healthBrazilDatasus", "healthBrazilCityProxy", "populationIbge"];
      return ["healthBrazilDatasus", "populationIbge"];
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
      <div class="legend-source" id="legend-source-block">
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

  function healthMetricsForActiveView() {
    const metrics = ANALYSIS_CATALOG.health.metrics;
    const keys = activeView === "world"
      ? ["uhcIndex", "lifeExpectancy", "hospitalBedsPer10000", "doctorsPer1000"]
      : ["bedsPer1000", "icuBedsPer100k", "doctorsPer1000", "infantMortality", "vaccinationCoverage"];
    return keys.reduce((acc, key) => {
      if (metrics[key]) acc[key] = metrics[key];
      return acc;
    }, {});
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

    if (legendCollapsed === null) legendCollapsed = isMobileLayout();
    const sourceHtml = legendSourceHtml(config.sourceIds);

    legend.classList.toggle("collapsed", Boolean(sourceHtml) && legendCollapsed);

    legend.innerHTML = `
      <div class="legend-head">
        <span>Mapa de calor | ${escapeHtml(config.scope)}</span>
        ${activeView === "census_tract" ? `<strong>${escapeHtml(config.metric)}</strong>` : (activeAnalysis === "hdi" ? `
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
        ` : (activeAnalysis === "health" ? `
          <div class="flex-gap-4">
            <select id="legend-health-selector" aria-label="Selecionar indicador de saude">
              ${renderMetricOptions(healthMetricsForActiveView(), activeHealthSubMetric)}
            </select>
          </div>
        ` : (activeAnalysis === "ips" && activeView !== "world" ? `
          <div class="flex-gap-4">
            <select id="legend-ips-selector" aria-label="Selecionar indicador do IPS">
              ${renderMetricOptions(ANALYSIS_CATALOG.ips.metrics, activeIpsSubMetric)}
            </select>
            <div class="year-stepper">
              <button type="button" id="ips-year-minus" title="Edição anterior" aria-label="Edição anterior">−</button>
              <select id="legend-ips-year-selector" aria-label="Selecionar edição do IPS">
                ${availableIpsYears.map((year) => `<option value="${escapeHtml(year)}" ${year === String(activeIpsYear) ? "selected" : ""}>IPS ${escapeHtml(year)}</option>`).join("")}
              </select>
              <button type="button" id="ips-year-plus" title="Próxima edição" aria-label="Próxima edição">+</button>
            </div>
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
        ` : `<strong>${escapeHtml(config.metric)}</strong>`)))))))}
      </div>
      ${config.categories ? `
        <div class="categorical-legend" role="list" aria-label="Cores por ${escapeHtml(config.metric.toLowerCase())}">
          <div class="categorical-legend-count">${formatNumber(config.categories.length)} categorias</div>
          ${config.categories.map((category, index) => `
            <div class="categorical-legend-item" role="listitem">
              <span class="categorical-legend-swatch" data-category-color-index="${index}" aria-hidden="true"></span>
              <span title="${escapeHtml(category.label)}">${escapeHtml(category.label)}</span>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="legend-scale" id="legend-gradient-scale"></div>
        <div class="legend-labels">
          ${config.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
        </div>
      `}
      ${sourceHtml ? `
        <button type="button" class="legend-toggle" id="legend-toggle" aria-expanded="${legendCollapsed ? "false" : "true"}" aria-controls="legend-source-block">
          <span class="legend-toggle-label">${legendCollapsed ? "Fonte e detalhes" : "Ocultar detalhes"}</span>
          <span class="legend-toggle-caret" aria-hidden="true">▾</span>
        </button>
      ` : ""}
      ${sourceHtml}
    `;

    const gradScale = legend.querySelector("#legend-gradient-scale");
    if (gradScale) {
      if (config.stepped) {
        // Faixas duras: a legenda espelha o mapa classificado, sem cor de transição.
        const size = 100 / config.colors.length;
        const bands = config.colors.map((color, index) => (
          `${color} ${(index * size).toFixed(2)}%, ${color} ${((index + 1) * size).toFixed(2)}%`
        ));
        gradScale.style.background = `linear-gradient(90deg, ${bands.join(", ")})`;
      } else {
        gradScale.style.background = `linear-gradient(90deg, ${config.colors.join(", ")})`;
      }
    }
    legend.querySelectorAll("[data-category-color-index]").forEach((swatch) => {
      const category = config.categories?.[Number(swatch.dataset.categoryColorIndex)];
      if (category) swatch.style.backgroundColor = category.color;
    });

    const legendToggle = legend.querySelector("#legend-toggle");
    if (legendToggle) {
      legendToggle.addEventListener("click", () => {
        legendCollapsed = !legendCollapsed;
        legend.classList.toggle("collapsed", legendCollapsed);
        legendToggle.setAttribute("aria-expanded", String(!legendCollapsed));
        const toggleLabel = legendToggle.querySelector(".legend-toggle-label");
        if (toggleLabel) toggleLabel.textContent = legendCollapsed ? "Fonte e detalhes" : "Ocultar detalhes";
      });
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

    const healthSelector = legend.querySelector("#legend-health-selector");
    if (healthSelector) {
      healthSelector.addEventListener("change", (e) => {
        activeHealthSubMetric = validAnalysisMetric("health", e.target.value) ? e.target.value : ANALYSIS_CATALOG.health.defaultMetric;
        if (window.updateWorldLayerColor) window.updateWorldLayerColor();
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      });
    }

    const ipsSelector = legend.querySelector("#legend-ips-selector");
    if (ipsSelector) {
      ipsSelector.addEventListener("change", (e) => {
        activeIpsSubMetric = validAnalysisMetric("ips", e.target.value) ? e.target.value : ANALYSIS_CATALOG.ips.defaultMetric;
        updateAnalysisPaint();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      });
    }

    const ipsYearSelector = legend.querySelector("#legend-ips-year-selector");
    if (ipsYearSelector) {
      const handleIpsYearChange = async (newYear) => {
        const year = String(newYear);
        if (!availableIpsYears.includes(year) || year === String(activeIpsYear)) return;

        // A base municipal do ano pode ainda não estar em memória.
        const needsFetch = !ipsCitiesByYear.has(year);
        if (needsFetch) showStatus(`Carregando IPS ${year}`, "Buscando a tabela municipal dessa edição.");
        activeIpsYear = year;
        await ensureIpsYearLoaded(year);
        syncIpsToActiveYear();
        if (needsFetch) hideStatus();

        updateAnalysisPaint();
        updateStateSources();
        updateHeatLegend();
        refreshAnalysisContent();
        refreshFixedDetailCard();
        savePreferences();
      };

      ipsYearSelector.addEventListener("change", (e) => { handleIpsYearChange(e.target.value); });

      const minus = legend.querySelector("#ips-year-minus");
      const plus = legend.querySelector("#ips-year-plus");
      // availableIpsYears está do mais novo para o mais antigo.
      const index = availableIpsYears.indexOf(String(activeIpsYear));
      if (minus) {
        minus.disabled = index >= availableIpsYears.length - 1;
        minus.addEventListener("click", () => { handleIpsYearChange(availableIpsYears[index + 1]); });
      }
      if (plus) {
        plus.disabled = index <= 0;
        plus.addEventListener("click", () => { handleIpsYearChange(availableIpsYears[index - 1]); });
      }
    }

    const yearSelector = legend.querySelector("#legend-year-selector");
    if (yearSelector) {
      const handleGdpYearChange = async (newYear) => {
        activeGdpYear = newYear;
        syncGdpToActiveYear();
        
        const collection = selectedStateId ? stateCitiesCache.get(selectedStateId) : null;
        if (collection) updateMunicipalitySources(collection);

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
    if (activeView === "census_tract" && currentSectorData) {
      const indicator = sectorIndicatorMeta(activeSectorIndicator);
      if (!indicator) return null;
      if (indicator.kind === "categorical") {
        return {
          metric: indicator.label,
          scope: "setores censitários",
          categories: sectorCategoricalEntries(currentSectorData),
          sourceIds: ["populationIbge"]
        };
      }
      const values = currentSectorData.features
        .map((feature) => Number(feature.properties?.[indicator.property]))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return {
        metric: indicator.label,
        scope: "setores censitários",
        colors: ["#17212b", "#1a5f8a", "#51d1c2", "#f2c14e", "#ff6b73"],
        labels: values.length ? [
          formatSectorIndicatorValue(values[0], indicator),
          formatSectorIndicatorValue(sectorQuantile(values, 0.5), indicator),
          formatSectorIndicatorValue(values.at(-1), indicator)
        ] : ["sem dado"],
        sourceIds: ["populationIbge"]
      };
    }
    if (!["states", "cities", "world"].includes(activeView)) return null;

    if (activeAnalysis === "hdi") {
      const year = resolveHdiYear();
      const isWorld = activeView === "world";
      const isCity = activeView === "cities" && selectedStateId;
      return {
        metric: `${isWorld ? "IDH" : "IDHM"} ${year || ""}`,
        scope: isWorld ? "Global" : (isCity ? "municípios da UF (proxy)" : "estados"),
        colors: ["#ff3b3b", "#ef7d60", "#f2c14e", "#a9d65c", "#17212b"],
        labels: ["baixo", "médio", "alto", "muito alto", "topo"],
        sourceIds: isWorld ? (activeSourceOption("hdi", "world")?.sourceIds || ["hdiGlobalUndp"]) : (isCity ? ["idhmPnudBrazil", "idhmCityProxy"] : ["idhmPnudBrazil"]),
        isWorld
      };
    }

    if (activeAnalysis === "ips" && activeView !== "world") {
      const isCityScope = activeView === "cities" && selectedStateId;
      const metricConfig = ANALYSIS_CATALOG.ips.metrics[activeIpsSubMetric] || ANALYSIS_CATALOG.ips.metrics.ipsGeral;
      const edition = ipsEdition();
      const hasCityData = ipsCityCount() > 0;
      const breaks = ipsClassBreaks();
      const formatBreak = (value) => value.toFixed(1).replace(".", ",");
      return {
        metric: `${metricConfig.metric}${edition ? ` ${edition}` : ""}`,
        scope: `${isCityScope ? (hasCityData ? "municípios" : "municípios da UF (proxy)") : "estados"}${edition ? ` ${edition}` : ""}`,
        colors: IPS_CLASS_COLORS,
        // Rótulos nos cortes que importam: piso, meio e teto das classes.
        labels: [
          `<${formatBreak(breaks[0])}`,
          formatBreak(breaks[Math.floor(breaks.length / 2)]),
          `${formatBreak(breaks[breaks.length - 1])}+`
        ],
        stepped: true,
        sourceIds: isCityScope
          ? (hasCityData ? ["ipsBrasilCities", "ipsBrasilImazon"] : ["ipsBrasilImazon", "ipsCityProxy"])
          : ["ipsBrasilImazon"]
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
        scope: isCity ? "municípios da UF (relativo)" : "estados",
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
        scope: isCity ? "municípios da UF (relativo)" : "estados",
        colors: ["#ff3b3b", "#ef7d60", "#f2c14e", "#79a95d", "#17212b"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "gdp"), "...", formatLabel(scale.max, "gdp")]
          : isCity 
            ? ["menor", activeCurrency === "BRL" ? "R$ 80 mil/hab." : "US$ 16 mil/hab.", activeCurrency === "BRL" ? "R$ 180 mil+" : "US$ 36 mil+"] 
            : ["menor", activeCurrency === "BRL" ? "R$ 42 mil/hab." : "US$ 8.4 mil/hab.", activeCurrency === "BRL" ? "R$ 120 mil+" : "US$ 24 mil+"]
      };
    }

    if (activeAnalysis === "politics") {
      return {
        metric: "Habitantes por político",
        scope: isCity ? "municípios da UF (relativo)" : "estados",
        colors: ["#ff3b3b", "#ef7d60", "#f2c14e", "#51d1c2", "#16212b"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "pol"), "...", formatLabel(scale.max, "pol")]
          : isCity ? ["menos gente", "25 mil", "180 mil+"] : ["1 mil", "5 mil", "8 mil+"]
      };
    }

    if (activeAnalysis === "travel") {
      return {
        metric: "Municípios documentados",
        scope: isCity ? "locais com vídeo" : "estados visitados",
        colors: ["#17212b", "#f2c14e"],
        labels: ["Sem vídeos", "Com documentários"]
      };
    }
    if (activeAnalysis === "stories") {
      return {
        metric: "Histórias dos municípios",
        scope: isCity ? "municípios com história" : "estados com histórias",
        colors: ["#17212b", "#b78ae8"],
        labels: ["Sem história", "Com história"]
      };
    }
    if (activeAnalysis === "sse") {
      const isCity = activeView === "cities" && selectedStateId;
      return {
        metric: "SSE total (0-100)",
        scope: isCity ? "municípios da UF" : "estados",
        colors: ["#ef7d60", "#f2c14e", "#a9d65c", "#4f8f70", "#1a5f8a"],
        labels: ["20", "40", "60", "80", "95"],
        sourceIds: ["healthBrazilDatasus", "securityBrazilFBSP", "enemLocal"]
      };
    }
    if (activeAnalysis === "health") {
      if (activeView === "world") {
        const metricLabels = {
          uhcIndex: "UHC cobertura essencial",
          lifeExpectancy: "Expectativa de vida",
          hospitalBedsPer10000: "Leitos por 10.000 hab.",
          doctorsPer1000: "Medicos por 10.000 hab."
        };
        const metric = activeHealthSubMetric || "uhcIndex";
        const labels = {
          uhcIndex: ["40", "60", "75", "85", "92+"],
          lifeExpectancy: ["55", "65", "72", "78", "84+"],
          hospitalBedsPer10000: ["5", "15", "30", "60", "100+"],
          doctorsPer1000: ["5", "15", "25", "40", "55+"]
        };
        return {
          metric: metricLabels[metric] || "UHC cobertura essencial",
          scope: "Global",
          colors: ["#ff3b3b", "#ef7d60", "#f2c14e", "#a9d65c", "#17212b"],
          labels: labels[metric] || labels.uhcIndex,
          sourceIds: ["healthGlobalWho", "healthGlobalWorldBank"],
          isWorld: true
        };
      }
      const metric = activeHealthSubMetric || "bedsPer1000";
      const metricLabels = {
        bedsPer1000: "Leitos por 1.000 hab.",
        icuBedsPer100k: "UTI por 100k hab.",
        doctorsPer1000: "Medicos por 1.000 hab.",
        infantMortality: "Mortalidade infantil por 1.000 NV",
        vaccinationCoverage: "Cobertura vacinal (%)"
      };
      const metricStops = {
        bedsPer1000: ["0,8", "1,4", "2,0", "2,6", "3,2+"],
        icuBedsPer100k: ["8", "14", "20", "26", "34+"],
        doctorsPer1000: ["0,8", "1,5", "2,2", "3,0", "4,5+"],
        infantMortality: ["8", "10", "12", "15", "18+"],
        vaccinationCoverage: ["70", "78", "84", "88", "92+"]
      };
      const negative = metric === "infantMortality";
      return {
        metric: metricLabels[metric] || metricLabels.bedsPer1000,
        scope: isCity ? "municípios da UF (municipal + proxy)" : "estados",
        colors: negative
          ? ["#1a5f8a", "#4f8f70", "#a9d65c", "#f2c14e", "#ff3b3b"]
          : ["#ff3b3b", "#ef7d60", "#f2c14e", "#a9d65c", "#17212b"],
        labels: (scale && scale.max > scale.min)
          ? [formatLabel(scale.min, "health"), "...", formatLabel(scale.max, "health")]
          : (metricStops[metric] || metricStops.bedsPer1000),
        sourceIds: isCity ? ["healthBrazilCitiesDatasus", "healthBrazilDatasus", "healthBrazilCityProxy", "populationIbge"] : ["healthBrazilDatasus", "populationIbge"]
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
      const scopeLabel = isCity ? "municípios da UF (IPEA + proxy)" : "estados";
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
        colors: ["#ff3b3b", "#ef7d60", "#f2c14e", "#5b8e54", "#25534e", "#17212b"],
        labels: labels,
        sourceIds: (WORLD_METRIC_CATALOG[activeWorldMetric] || WORLD_METRIC_CATALOG.pop).sourceIds,
        isWorld: true
      };
    }

    return {
      metric: "População",
      scope: isCity ? "municípios da UF (relativo)" : "estados",
      colors: isCity
        ? ["#ff3b3b", "#ef7d60", "#f2c14e", "#5b8e54", "#25534e", "#17212b"]
        : ["#ff3b3b", "#ef7d60", "#f2c14e", "#5b8e54", "#17212b"],
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
        setActiveView("census_tract");
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

  function scheduleCountryClick(lngLat, props, feature) {
    clearPendingCountryClick();
    countryClickTimer = window.setTimeout(() => {
      countryClickTimer = null;
      clearHoverPopup();
      selectCountry(props, feature);
      showCountryPopup(lngLat, feature.properties || props);
    }, 240);
  }

  function clearPendingCountryClick() {
    if (countryClickTimer) window.clearTimeout(countryClickTimer);
    countryClickTimer = null;
  }

  function addBaseLayers() {
    const bases = [
      {
        id: "earth",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        maxzoom: 19,
        attribution: "Tiles © Esri — Esri, Maxar, Earthstar Geographics e comunidade GIS"
      },
      {
        id: "map",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors"
      },
      {
        id: "hybrid",
        tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
        maxzoom: 20,
        attribution: "© OpenStreetMap contributors © CARTO"
      }
    ];
    bases.forEach((base) => {
      const sourceId = `base-${base.id}-source`;
      const layerId = `base-${base.id}-layer`;
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "raster",
          tiles: base.tiles,
          tileSize: 256,
          maxzoom: base.maxzoom,
          attribution: base.attribution
        });
      }
      addLayerOnce({
        id: layerId,
        type: "raster",
        source: sourceId,
        layout: { visibility: base.id === activeBaseMode ? "visible" : "none" },
        paint: { "raster-opacity": 1, "raster-fade-duration": 180 }
      });
    });
  }

  function updateEditorialHeader() {
    const editorial = ANALYSIS_EDITORIAL[activeAnalysis] || ANALYSIS_EDITORIAL.general;
    const state = selectedStateId ? stateById.get(String(selectedStateId)) : null;
    const municipalityName = selectedCityFeature && selectedCityFeature.properties
      ? selectedCityFeature.properties.name
      : "";
    const scopes = {
      world: {
        kicker: "Mundo",
        suffix: "no mundo",
        summary: "Passe o mouse ou clique em um país; dê duplo clique no Brasil para abrir os estados."
      },
      states: {
        kicker: "Brasil | Estados",
        suffix: "nos estados brasileiros",
        summary: "Compare as UFs e dê duplo clique em um estado para abrir seus municípios."
      },
      cities: {
        kicker: state ? `Brasil | ${state.sigla} | Municípios` : "Brasil | Municípios",
        suffix: state ? `nos municípios de ${state.sigla}` : "nos municípios brasileiros",
        summary: state
          ? `Compare os municípios de ${state.nome} e dê duplo clique em um deles para abrir seus setores censitários.`
          : "Escolha ou dê duplo clique em um estado para carregar seus municípios."
      },
      census_tract: {
        kicker: municipalityName ? `Brasil | Setores | ${municipalityName}` : "Brasil | Setores censitários",
        suffix: municipalityName ? `nos setores censitários de ${municipalityName}` : "nos setores censitários",
        summary: "Explore os indicadores do Censo 2022 por setor censitário, com observações, estimativas e proxies identificados."
      }
    };
    const scope = scopes[activeView] || scopes.world;
    if (elements["brand-kicker"]) elements["brand-kicker"].textContent = `${editorial.kicker} | ${scope.kicker}`;
    if (elements["brand-title"]) elements["brand-title"].textContent = `${editorial.title} ${scope.suffix}`;
    if (elements["brand-subtitle"]) elements["brand-subtitle"].textContent = `${editorial.summary} ${scope.summary}`;
    document.title = `Atlas Brasil | ${editorial.title} ${scope.suffix}`;
  }

  function setBaseMode(mode) {
    activeBaseMode = validBaseMode(mode) ? mode : "earth";
    const offlineBackgrounds = { map: "#dce8ec", earth: "#10251f", hybrid: "#06131c" };
    if (map.getLayer("offline-background")) {
      map.setPaintProperty("offline-background", "background-color", offlineBackgrounds[activeBaseMode]);
    }
    ["earth", "map", "hybrid"].forEach((baseId) => {
      const layerId = `base-${baseId}-layer`;
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", baseId === activeBaseMode ? "visible" : "none");
      }
    });
    applyBaseModeToAtlasLayers();
    setBaseAdministrativeBoundariesVisible(activeView !== "brazil");
    const activeButton = document.querySelector(`[data-base="${activeBaseMode}"]`);
    if (activeButton) setActiveButton("[data-base]", activeButton);
    savePreferences();
  }

  function applyBaseModeToAtlasLayers() {
    if (!map) return;
    const modes = {
      map: {
        fill: { brazil: 0.54, states: 0.5, municipalities: 0.48, sectors: 0.66 },
        outline: "rgba(24, 54, 68, 0.72)", label: "#183644", halo: "#f7fbfc"
      },
      earth: {
        fill: { brazil: 0.72, states: 0.68, municipalities: 0.64, sectors: 0.76 },
        outline: "rgba(244, 249, 241, 0.78)", label: "#ffffff", halo: "#102a24"
      },
      hybrid: {
        fill: { brazil: 0.86, states: 0.8, municipalities: 0.76, sectors: 0.88 },
        outline: "rgba(237, 243, 238, 0.64)", label: "#edf3ee", halo: "#07121b"
      }
    };
    const visual = modes[activeBaseMode] || modes.hybrid;
    setLayerPaint("brazil-fill", { "fill-opacity": visual.fill.brazil });
    setLayerPaint("states-fill", { "fill-opacity": activeAnalysis === "ips" ? Math.max(visual.fill.states, 0.82) : visual.fill.states });
    setLayerPaint("municipality-fill", { "fill-opacity": activeAnalysis === "ips" ? Math.max(visual.fill.municipalities, 0.78) : visual.fill.municipalities });
    setLayerPaint("world-fill", { "fill-opacity": visual.fill.states });
    setLayerPaint("setores-fill", { "fill-opacity": visual.fill.sectors });
    ["world-outline", "states-outline", "municipality-outline", "setores-outline"].forEach((id) => {
      setLayerPaint(id, { "line-color": visual.outline });
    });
    ["states-labels", "municipality-labels"].forEach((id) => {
      setLayerPaint(id, { "text-color": visual.label, "text-halo-color": visual.halo });
    });
  }

  function tuneBaseMapPaint(mode) {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (layer.id === "offline-background" || layer.id === "satellite-layer" || isAtlasLayer(layer.id)) return;
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
    return id.startsWith("brazil-") || id.startsWith("states-") || id.startsWith("selected-state") || id.startsWith("municipality-") || id.startsWith("setores-") || id.startsWith("world-") || id.startsWith("selected-country");
  }

  function setLayerVisibility(group, visible) {
    const prefix = group === "municipality" ? "municipality-" : "states-";
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach((layer) => {
      if (layer.id.startsWith(prefix)) {
        const layerVisible = visible && (!layer.id.endsWith("-bubbles") || bubblesEnabled);
        map.setLayoutProperty(layer.id, "visibility", layerVisible ? "visible" : "none");
      }
    });
  }

  function setLayersVisibility(layerIds, visible) {
    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        const layerVisible = visible && (!layerId.endsWith("-bubbles") || bubblesEnabled);
        map.setLayoutProperty(layerId, "visibility", layerVisible ? "visible" : "none");
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
    const sectorsVisible = activeView === "census_tract";
    setLayersVisibility(["setores-fill", "setores-outline"], sectorsVisible);
    if (elements["sector-indicator-controls"]) {
      elements["sector-indicator-controls"].hidden = !sectorsVisible;
    }
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
      if (activeAnalysis === "travel" || activeAnalysis === "stories") {
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

    if (activeView === "census_tract") {
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
        setActiveView(view);
        
        if (view === "world") {
          enterWorldMode();
        } else if (view === "brazil") {
          enterBrazilOverviewMode();
        } else if (view === "states") {
          enterStateAnalysisMode({ selectBrazil: true });
        } else if (view === "cities") {
          if (selectedStateId) {
            loadStateCities(selectedStateId);
          } else {
            enterCitiesChooserMode();
          }
        } else if (view === "census_tract") {
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

    document.querySelectorAll("[data-currency]").forEach((button) => {
      button.addEventListener("click", () => {
        setActiveButton("[data-currency]", button);
        activeCurrency = button.dataset.currency;
        savePreferences();
        refreshActiveViews();
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

    if (elements["bubbles-toggle"]) {
      elements["bubbles-toggle"].addEventListener("click", () => {
        setBubblesEnabled(!bubblesEnabled);
        savePreferences();
      });
    }

    if (elements["sector-indicator-select"]) {
      elements["sector-indicator-select"].addEventListener("change", (event) => {
        applySectorIndicator(event.target.value);
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
    ensureHealthMetricForView();
    const button = document.querySelector(`[data-view="${view}"]`);
    if (button) setActiveButton("[data-view]", button);
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    updateHeatLegend();
    updateEditorialHeader();
    savePreferences();
  }

  function setActiveAnalysis(analysis) {
    activeAnalysis = validAnalysis(analysis) ? analysis : "general";
    const config = activeAnalysisConfig();
    ensureHealthMetricForView();
    if (config.metrics && !validAnalysisMetric(activeAnalysis, activeGdpSubMetric)) {
      activeGdpSubMetric = config.defaultMetric || Object.keys(config.metrics)[0];
    }
    const button = document.querySelector(`[data-analysis="${activeAnalysis}"]`);
    if (button) setActiveButton("[data-analysis]", button);
    if (elements["analysis-caption"]) elements["analysis-caption"].textContent = analysisLabel(activeAnalysis);
    updateEditorialHeader();
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

  function ensureHealthMetricForView() {
    if (activeAnalysis !== "health") return;
    const metrics = healthMetricsForActiveView();
    if (!Object.prototype.hasOwnProperty.call(metrics, activeHealthSubMetric)) {
      activeHealthSubMetric = activeView === "world" ? "uhcIndex" : ANALYSIS_CATALOG.health.defaultMetric;
    }
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
    } else if (activeView === "census_tract") {
      setActiveView("census_tract");
      if (savedPreferences.selectedStateId && stateById.has(String(savedPreferences.selectedStateId))) {
        await loadStateCities(savedPreferences.selectedStateId, savedPreferences.selectedCityId, { preserveCamera: true });
      }
      await flyToStreet({ preserveCamera });
    } else {
      setActiveView("world");
      await enterWorldMode({ preserveCamera });
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
    renderEmptyRanking("Clique no Brasil no globo para ler os totais ou use Estados para comparar as UFs.");
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
    renderEmptyRanking("Passe o mouse sobre um estado para ler os dados. Dê duplo clique em uma UF para explorar seus municípios.");
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
    elements["hud-layer"].textContent = "Municípios";
    elements["metric-state"].textContent = "Brasil";
    elements["metric-state-pop"].textContent = "duplo clique em uma UF";
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "escolha um estado";
    renderSelectedBrazil();
    renderStateChart();
    renderEmptyRanking("Dê duplo clique em uma UF para carregar os municípios antes de entrar no detalhe.");
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
    elements["hud-layer"].textContent = "Municípios";
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
          <span class="result-meta">${escapeHtml(item.type === "state" ? "Unidade da Federação" : item.meta || "Município")}</span>
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
    elements["metric-city-count"].textContent = cityById.size ? `${formatNumber(cityById.size)} municípios` : "municípios ao carregar";
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
    updateEditorialHeader();
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
    updateEditorialHeader();
    updateSelectedCitySource(feature);

    elements["metric-city"].textContent = props.name;
    elements["metric-city-pop"].textContent = formatNumber(props.pop || 0);
    elements["selected-code"].textContent = props.id;
    elements["selected-type"].textContent = "Município";
    elements["selected-name"].textContent = `${props.name} (${props.uf})`;
    elements["selected-pop"].textContent = formatNumber(props.pop || 0);
    const stateId = props.stateId || (props.id && String(props.id).length >= 2 ? String(props.id).substring(0, 2) : "");
    const state = stateById.get(String(stateId));
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
      const isIps = bar.dataset.kind === "ips";
      const activeColor = isIps ? "#4f9bd9" : (isHdi ? "#a9d65c" : "var(--gold)");
      const idleColor = isIps
        ? "rgba(79,155,217,0.45)"
        : (isHdi ? "rgba(169,214,92,0.45)" : "rgba(242,193,78,0.45)");
      bar.style.flex = "1";
      bar.style.height = h + "%";
      bar.style.background = isActive ? activeColor : (isMock ? "rgba(242,193,78,0.15)" : idleColor);
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
    applyGdpHistoryStyles("ips-history-chart");
    applySseBarStyles();
    if (window.lucide) window.lucide.createIcons();
  }

  function renderGeneralCards(caption, cards) {
    elements["general-caption"].textContent = caption;
    elements["general-grid"].innerHTML = cards.map((card) => {
      if (card.isHtml) {
        return `<div class="grid-full-span">${card.value}</div>`;
      }
      const valStr = card.isValueHtml ? card.value : escapeHtml(card.value);
      return `
        <div>
          <span>${escapeHtml(card.label)}</span>
          <strong>${valStr}</strong>
        </div>
      `;
    }).join("");
    applyGdpHistoryStyles("gdp-history-chart");
    applyGdpHistoryStyles("hdi-history-chart");
    applyGdpHistoryStyles("ips-history-chart");
    applySseBarStyles();
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
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShort(props.gdp) },
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
    if (activeAnalysis === "ips") return ipsCards(scope, data);
    if (activeAnalysis === "politics") return politicsCards(scope, data);
    if (activeAnalysis === "education") return educationCards(scope, data);
    if (activeAnalysis === "security") return securityCards(scope, data);
    if (activeAnalysis === "health") return healthCards(scope, data);
    if (activeAnalysis === "sse") return sseCards(scope, data);
    if (activeAnalysis === "travel") return travelCards(scope, data);
    if (activeAnalysis === "stories") return storiesCards(scope, data);
    if (scope === "state") return stateGeneralCards(data);
    if (scope === "city") return cityGeneralCards(data);
    return brazilGeneralCards();
  }

  function healthCards(scope, data) {
    const metric = activeHealthSubMetric || (activeView === "world" ? "uhcIndex" : "bedsPer1000");
    const metricLabels = {
      bedsPer1000: "Leitos",
      icuBedsPer100k: "UTI",
      doctorsPer1000: "Medicos",
      infantMortality: "Mortalidade infantil",
      vaccinationCoverage: "Vacinacao",
      uhcIndex: "UHC",
      lifeExpectancy: "Expectativa de vida",
      hospitalBedsPer10000: "Leitos"
    };
    const valueForMetric = (row) => row[healthMetricField()] || row[metric] || 0;
    const formatHealthValue = (key, value) => {
      if (key === "lifeExpectancy") return value ? `${value.toFixed(1)} anos` : "sem dado";
      if (key === "uhcIndex" || key === "vaccinationCoverage" || key === "privateCoverage") return value ? `${value.toFixed(1)}%` : "sem dado";
      if (key === "hospitalBedsPer10000" || key === "physiciansPer10000") return value ? `${value.toFixed(1)} por 10k` : "sem dado";
      if (key === "infantMortality") return value ? `${value.toFixed(1)} por 1.000 NV` : "sem dado";
      if (key === "maternalMortality") return value ? `${value.toFixed(1)} por 100k NV` : "sem dado";
      if (key === "icuBedsPer100k") return value ? `${value.toFixed(1)} por 100k` : "sem dado";
      return value ? `${value.toFixed(1)} por 1.000` : "sem dado";
    };

    if (scope === "state") {
      return [
        { label: `${metricLabels[metric] || "Saude"} ${data.healthYear || 2023}`, value: formatHealthValue(metric, valueForMetric(data)) },
        { label: "Ranking do indicador", value: rankTextByMetric(Array.from(stateById.values()), data.id, (row) => row[healthMetricField()] || 0, "no Brasil") },
        { label: "Leitos totais", value: formatHealthValue("bedsPer1000", data.bedsPer1000 || 0) },
        { label: "Leitos SUS", value: formatHealthValue("bedsPer1000", data.susBedsPer1000 || 0) },
        { label: "UTI", value: formatHealthValue("icuBedsPer100k", data.icuBedsPer100k || 0) },
        { label: "Medicos", value: formatHealthValue("doctorsPer1000", data.doctorsPer1000 || 0) },
        { label: "Mortalidade infantil", value: formatHealthValue("infantMortality", data.infantMortality || 0) },
        { label: "Fonte", value: compactSourceLine(["healthBrazilDatasus", "populationIbge"]) }
      ];
    }
    if (scope === "city") {
      const sourceIds = data.healthCoverage === "real"
        ? ["healthBrazilCitiesDatasus", "populationIbge"]
        : (data.healthCoverage === "partial"
            ? ["healthBrazilCitiesDatasus", "healthBrazilDatasus", "healthBrazilCityProxy", "populationIbge"]
            : ["healthBrazilDatasus", "healthBrazilCityProxy", "populationIbge"]);

      const isFieldReal = (field) => {
        if (data.healthCoverage === "real") return true;
        if (data.healthCoverage === "partial" && Array.isArray(data.healthRealFields) && data.healthRealFields.includes(field)) return true;
        return false;
      };

      const cards = [];

      const isMainReal = isFieldReal(metric);
      cards.push({
        label: `${metricLabels[metric] || "Saúde"} ${data.healthYear || 2023}${isMainReal ? "" : " (Proxy UF)"}`,
        value: formatHealthValue(metric, valueForMetric(data))
      });

      let levelValue = "Proxy pela UF, não município";
      let isHtmlVal = false;
      if (data.healthCoverage === "real") {
        levelValue = "Dado municipal";
      } else if (data.healthCoverage === "partial") {
        levelValue = `Misto <a href="#" class="help-tooltip" onclick="event.preventDefault();" title="Alguns indicadores são reais e outros são baseados no proxy da UF. Veja abaixo quais são reais.">?</a>`;
        isHtmlVal = true;
      }
      cards.push({
        label: "Nível do dado",
        value: levelValue,
        isValueHtml: isHtmlVal
      });

      cards.push({
        label: "UF usada",
        value: `${data.stateName || ""} (${data.uf || ""})`
      });

      if (data.healthCoverage === "partial") {
        const realNames = Array.isArray(data.healthRealFields)
          ? data.healthRealFields.map(f => metricLabels[f] || f).join(", ")
          : "";
        cards.push({
          label: "Indicadores reais",
          value: realNames || "Nenhum"
        });
      }

      const isBedsReal = isFieldReal("bedsPer1000");
      cards.push({
        label: isBedsReal ? "Leitos totais" : "Leitos totais (Proxy UF)",
        value: formatHealthValue("bedsPer1000", data.bedsPer1000 || 0)
      });

      const isIcuReal = isFieldReal("icuBedsPer100k");
      cards.push({
        label: isIcuReal ? "UTI" : "UTI (Proxy UF)",
        value: formatHealthValue("icuBedsPer100k", data.icuBedsPer100k || 0)
      });

      const isMortReal = isFieldReal("infantMortality");
      cards.push({
        label: isMortReal ? "Mortalidade infantil" : "Mortalidade infantil (Proxy UF)",
        value: formatHealthValue("infantMortality", data.infantMortality || 0)
      });

      cards.push({
        label: "Fonte",
        value: compactSourceLine(sourceIds)
      });

      return cards;
    }
    const brData = healthBrazilData ? healthBrazilData.brazil : {};
    return [
      { label: `${metricLabels[metric] || "Saude"} Brasil ${brData.year || 2023}`, value: formatHealthValue(metric, brData[healthMetricField()] || brData[metric] || 0) },
      { label: "Leitos totais", value: formatHealthValue("bedsPer1000", brData.bedsPer1000 || 0) },
      { label: "Leitos SUS", value: formatHealthValue("bedsPer1000", brData.susBedsPer1000 || 0) },
      { label: "UTI", value: formatHealthValue("icuBedsPer100k", brData.icuBedsPer100k || 0) },
      { label: "Medicos", value: formatHealthValue("doctorsPer1000", brData.doctorsPer1000 || 0) },
      { label: "Mortalidade infantil", value: formatHealthValue("infantMortality", brData.infantMortality || 0) },
      { label: "Fonte", value: compactSourceLine(["healthBrazilDatasus", "populationIbge"]) }
    ];
  }
  function sseBarsHtml(scores) {
    const rows = [
      { key: "sseTotal", label: "SSE", color: "#a9d65c", value: scores.sseTotal },
      { key: "saudeScore", label: "Saúde", color: "#51d1c2", value: scores.saudeScore },
      { key: "segurancaScore", label: "Segur.", color: "#ef7d60", value: scores.segurancaScore },
      { key: "educacaoScore", label: "Educ.", color: "#b8e8e0", value: scores.educacaoScore },
    ];
    const bars = rows.map((row) => {
      const h = Math.max(2, Math.min(100, row.value || 0));
      return `
        <div class="sse-col" data-k="${escapeHtml(row.key)}">
          <div class="sse-col-value">${row.value.toFixed(1)}</div>
          <div class="sse-bar-track">
            <div class="sse-bar-fill" data-w="${h}" data-c="${escapeHtml(row.color)}"></div>
          </div>
          <div class="sse-col-label">${escapeHtml(row.label)}</div>
        </div>
      `;
    }).join("");
    return `<div class="sse-bars">${bars}</div>`;
  }

  function applySseBarStyles() {
    document.querySelectorAll(".sse-bar-fill").forEach((bar) => {
      if (bar.style.height) return;
      bar.style.height = bar.dataset.w + "%";
      bar.style.background = bar.dataset.c;
    });
  }

  function brazilSseScores() {
    const bp = brazilMeshFeature ? brazilMeshFeature.properties : {};
    // National ENEM = simple avg of state values for active year
    const enemMap = ENEM_HISTORY_SCORES[activeEnemYear] || {};
    const enemValues = Object.values(enemMap).filter((v) => v > 0);
    const enemAvg = enemValues.length ? enemValues.reduce((a, b) => a + b, 0) / enemValues.length : 0;
    return sseScores({
      bedsPer1000: bp.bedsPer1000 || 0,
      doctorsPer1000: bp.doctorsPer1000 || 0,
      vaccinationCoverage: bp.vaccinationCoverage || 0,
      infantMortality: bp.infantMortality || 0,
      mviRate: bp.mviRate || 0,
      enemScore: enemAvg,
    });
  }

  function sseCards(scope, data) {
    let scores;
    if (scope === "state") {
      // state objects do not carry sseTotal directly - recompute from raw fields
      const enemScore = (ENEM_HISTORY_SCORES[activeEnemYear] || {})[data.sigla] || 0;
      scores = sseScores({
        bedsPer1000: data.bedsPer1000,
        doctorsPer1000: data.doctorsPer1000,
        vaccinationCoverage: data.vaccinationCoverage,
        infantMortality: data.infantMortality,
        mviRate: data.mviRate,
        enemScore: enemScore,
      });
    } else if (scope === "city") {
      // city feature properties already have the merged scores
      scores = {
        sseTotal: Number(data.sseTotal) || 0,
        saudeScore: Number(data.saudeScore) || 0,
        segurancaScore: Number(data.segurancaScore) || 0,
        educacaoScore: Number(data.educacaoScore) || 0,
      };
    } else {
      scores = brazilSseScores();
    }
    return [
      { isHtml: true, value: sseBarsHtml(scores) },
      { label: "Fórmula", value: "média simples 1/3 de cada dimensão (0-100)" },
      { label: "Saúde inclui", value: "leitos, médicos, vacinação, mort. infantil (inv.)" },
      { label: "Segurança inclui", value: "MVI invertido (0=100, 50+=0)" },
      { label: "Educação inclui", value: `nota ENEM ${activeEnemYear || ""} normalizada 450-650` },
      { label: "Versão", value: "V1 simplificada — refinar pesos depois" },
      { label: "Fonte", value: compactSourceLine(["healthBrazilDatasus", "securityBrazilFBSP", "enemLocal"]) },
    ];
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
      const metricHasMunicipalData = metric === "mviRate" && isReal;
      const sourceIds = metricHasMunicipalData ? ["securityBrazilIPEACities"] : ["securityBrazilFBSP", "securityBrazilCityProxy"];
      const cards = [
        { label: `${metricLabel} ${data.securityYear || 2023}${metricHasMunicipalData ? "" : " (Proxy UF)"}`, value: `${valueForMetric(data).toFixed(1)} por 100k` },
        { label: "Nível do dado", value: metricHasMunicipalData ? "IPEA Atlas municipal" : "Proxy pela UF" },
        { label: "UF", value: `${data.stateName || ""} (${data.uf || ""})` },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Fonte", value: compactSourceLine(sourceIds) }
      ];
      if (metricHasMunicipalData && data.homicideRate) {
        cards.splice(1, 0, { label: `Homicídios IPEA ${data.securityYear || 2022}`, value: `${data.homicideRate.toFixed(1)} por 100k` });
        if (data.estimatedHomicides) cards.splice(2, 0, { label: "Homicídios estimados", value: formatNumber(data.estimatedHomicides) });
        if (data.securityRank) cards.splice(3, 0, { label: "Ranking Atlas", value: `${formatNumber(data.securityRank)} de 319` });
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
        { label: "Nível do dado", value: "UF, não município" },
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

  function ipsCards(scope, data) {
    const edition = ipsEdition();
    const brazil = ipsBrazilForYear(edition);
    const dimensionLabels = (ipsBrazilData && ipsBrazilData.dimensionLabels) || {
      basicNeeds: "Necessidades Humanas Básicas",
      wellbeing: "Fundamentos do Bem-estar",
      opportunity: "Oportunidades"
    };
    // O card destaca o indicador escolhido no seletor, mas sempre mostra os quatro.
    const activeKey = ipsMetricKey();
    const highlight = (key, label) => (key === activeKey ? `${label} (no mapa)` : label);

    if (scope === "state") {
      const value = data.ips || 0;
      const rank = data.ipsRank || 0;
      const dimensions = data.ipsDimensions || {};
      return [
        { label: highlight("ipsGeral", `IPS ${edition}`), value: formatIps(value) },
        { label: "Ranking entre UFs", value: rank ? `${rank}º de 27` : "-" },
        { label: highlight("basicNeeds", dimensionLabels.basicNeeds), value: formatIps(dimensions.basicNeeds) },
        { label: highlight("wellbeing", dimensionLabels.wellbeing), value: formatIps(dimensions.wellbeing) },
        { label: highlight("opportunity", dimensionLabels.opportunity), value: formatIps(dimensions.opportunity) },
        { label: "Brasil", value: brazil ? formatIps(brazil.ips) : "-" },
        { label: "Diferença p/ o Brasil", value: (value && brazil) ? `${value >= brazil.ips ? "+" : ""}${(value - brazil.ips).toFixed(2).replace(".", ",")}` : "-" },
        { label: "Fonte", value: compactSourceLine(isLatestIpsYear() ? ["ipsBrasilImazon"] : ["ipsBrasilCities"]) },
        { label: "Histórico BR", value: renderIpsHistoryChart(), isHtml: true }
      ];
    }

    if (scope === "city") {
      const value = data.ips || 0;
      if (!data.ipsReal) {
        return [
          { label: `IPS ${edition}`, value: `${formatIps(value)} (proxy UF)` },
          { label: "Nível do dado", value: "UF, não município" },
          { label: "UF usada", value: `${data.stateName || ""} (${data.uf || ""})` },
          { label: "Brasil", value: brazil ? formatIps(brazil.ips) : "-" },
          { label: "Fonte", value: compactSourceLine(["ipsBrasilImazon", "ipsCityProxy"]) }
        ];
      }

      const dimensions = data.ipsDimensions || {};
      const total = ipsCityCount();
      const stateValue = data.ipsStateValue || 0;
      return [
        { label: highlight("ipsGeral", `IPS ${data.ipsYear || edition}`), value: formatIps(value) },
        { label: "Ranking nacional", value: data.ipsRank ? `${formatNumber(data.ipsRank)}º de ${formatNumber(total)}` : "-" },
        { label: highlight("basicNeeds", dimensionLabels.basicNeeds), value: formatIps(dimensions.basicNeeds) },
        { label: highlight("wellbeing", dimensionLabels.wellbeing), value: formatIps(dimensions.wellbeing) },
        { label: highlight("opportunity", dimensionLabels.opportunity), value: formatIps(dimensions.opportunity) },
        { label: `Média da UF (${data.uf || ""})`, value: stateValue ? formatIps(stateValue) : "-" },
        { label: "Diferença p/ a UF", value: (value && stateValue) ? `${value >= stateValue ? "+" : ""}${(value - stateValue).toFixed(2).replace(".", ",")}` : "-" },
        { label: "Brasil", value: brazil ? formatIps(brazil.ips) : "-" },
        { label: "Fonte", value: compactSourceLine(["ipsBrasilCities"]) }
      ];
    }

    if (!brazil) {
      return [{ label: "IPS Brasil", value: "sem dado carregado" }];
    }

    const states = ipsBrazilData ? Object.values(ipsBrazilData.states) : [];
    const best = states.find((row) => row.rank === 1);
    const worst = states.find((row) => row.rank === states.length);
    const cityRows = ipsBrazilCitiesData ? Object.values(ipsBrazilCitiesData.cities || {}) : [];
    const bestCity = cityRows.find((row) => row.rank === 1);
    const worstCity = cityRows.find((row) => row.rank === cityRows.length);
    return [
      { label: `IPS Brasil ${edition}`, value: formatIps(brazil.ips) },
      { label: dimensionLabels.basicNeeds, value: formatIps(brazil.dimensions && brazil.dimensions.basicNeeds) },
      { label: dimensionLabels.wellbeing, value: formatIps(brazil.dimensions && brazil.dimensions.wellbeing) },
      { label: dimensionLabels.opportunity, value: formatIps(brazil.dimensions && brazil.dimensions.opportunity) },
      { label: "Melhor UF", value: best ? `${best.uf} ${formatIps(best.ips)}` : "-" },
      { label: "Menor UF", value: worst ? `${worst.uf} ${formatIps(worst.ips)}` : "-" },
      { label: "Melhor município", value: bestCity ? `${bestCity.name} ${formatIps(bestCity.ips)}` : "-" },
      { label: "Menor município", value: worstCity ? `${worstCity.name} ${formatIps(worstCity.ips)}` : "-" },
      { label: "Municípios cobertos", value: cityRows.length ? formatNumber(cityRows.length) : "-" },
      { label: "Edições disponíveis", value: availableIpsYears.slice().reverse().join(" | ") || "-" },
      { label: "Fonte", value: compactSourceLine(cityRows.length ? ["ipsBrasilImazon", "ipsBrasilCities"] : ["ipsBrasilImazon"]) },
      { label: "Histórico BR", value: renderIpsHistoryChart(), isHtml: true }
    ];
  }

  function renderIpsHistoryChart() {
    // Usa a série RECALCULADA do relatório, não os valores por edição: só ela é
    // comparável entre anos (a fonte é explícita sobre isso).
    const history = ipsBrazilData && ipsBrazilData.brazil ? ipsBrazilData.brazil.recalculatedSeries : null;
    if (!history) return "";
    const years = Object.keys(history).sort((a, b) => Number(a) - Number(b));
    if (years.length < 2) return "";

    const values = years.map((year) => Number(history[year].ips) || 0).filter((value) => value > 0);
    if (values.length !== years.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 0.5);

    return `
      <div class="mt-12 pt-10 border-top-line w-full">
        <div class="pib-history-header">IPS Brasil | série recalculada (comparável)</div>
        <div class="pib-history-container" id="ips-history-chart">
          ${years.map((year) => {
            const value = Number(history[year].ips) || 0;
            const height = Math.max(8, ((value - min) / span) * 92 + 8);
            const isActive = String(year) === ipsEdition();
            return `<div class="pib-history-bar" title="${escapeHtml(year)}: ${escapeHtml(formatIps(value))}" data-kind="ips" data-h="${height}" data-active="${isActive}" data-mock="false"></div>`;
          }).join("")}
        </div>
        <div class="pib-history-footer">
          <span>${escapeHtml(String(years[0]))}</span>
          <span>${escapeHtml(String(years[years.length - 1]))}</span>
        </div>
      </div>
    `;
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
      const stateId = data.stateId || (data.id && String(data.id).length >= 2 ? String(data.id).substring(0, 2) : "");
      const state = stateById.get(String(stateId));
      const cities = citiesForState(stateId);
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
      { label: "Comparação", value: "Estados e municípios" },
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
        { label: "Dados por município", value: "estimativa projetada" },
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
        { label: "Municípios documentados", value: docCount > 0 ? formatNumber(docCount) : "Ainda não" },
        { label: "População", value: formatNumber(data.pop || 0) },
        { label: "Mapa de calor", value: "Estados com documentários" }
      ];
    }
    if (scope === "city") {
      const doc = DOCUMENTED_CITIES[data.id];
      const cards = [
        { label: "Documentário", value: doc ? "Disponível" : "Ainda não" },
        { label: "Município", value: data.name },
        { label: "Estado", value: data.uf }
      ];
      if (doc && doc.v) {
        const safeHref = escapeHtml(doc.v);
        cards.push({
          label: "Vídeo",
          value: `
            <div class="mt-6 w-full">
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
      { label: "Total de municípios mapeados", value: Object.keys(DOCUMENTED_CITIES).length.toString() }
    ];
  }

  function formatStoryDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || "";
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
  }

  function storyCityList(stateId) {
    const ids = storyCityIds().filter((id) => !stateId || id.startsWith(stateId));
    return ids
      .map((id) => ({ id, story: storyForCity(id) }))
      .filter((item) => item.story)
      .sort((a, b) => a.story.name.localeCompare(b.story.name, "pt-BR"));
  }

  function storyListHtml(items) {
    return `
      <ul class="story-list">
        ${items.map(({ story }) => `
          <li><strong>${escapeHtml(story.name)} (${escapeHtml(story.uf)})</strong><span>${escapeHtml(story.arquetipo || "")}</span></li>
        `).join("")}
      </ul>
    `;
  }

  function storyCardHtml(story) {
    const confidence = { alta: "confiança alta", media: "confiança média", baixa: "confiança baixa" }[story.confianca] || "";
    const paragraphs = String(story.historia || "").split(/\n+/).map((part) => `<p>${escapeHtml(part)}</p>`).join("");
    const sinais = Array.isArray(story.sinaisUsados) && story.sinaisUsados.length
      ? `<details class="story-details"><summary>Sinais usados</summary><ul>${story.sinaisUsados.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`
      : "";
    const lacunas = Array.isArray(story.lacunas) && story.lacunas.length
      ? `<details class="story-details"><summary>Lacunas declaradas</summary><ul>${story.lacunas.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`
      : "";
    return `
      <div class="story-card">
        <div class="story-tags">
          <span class="story-badge">${escapeHtml(story.arquetipo || "sem arquétipo claro")}</span>
          ${story.arquetipoSecundario ? `<span class="story-badge secondary">${escapeHtml(story.arquetipoSecundario)}</span>` : ""}
          ${confidence ? `<span class="story-confidence ${escapeHtml(story.confianca)}">${escapeHtml(confidence)}</span>` : ""}
        </div>
        <div class="story-text">${paragraphs}</div>
        ${sinais}
        ${lacunas}
        <div class="story-seal">
          Texto gerado por IA em ${escapeHtml(formatStoryDate(story.geradoEm))} a partir de dados do IBGE.
          <a href="https://github.com/inteligenciamilgrau/atlasbrasil/issues" target="_blank" rel="noopener noreferrer">Encontrou um erro?</a>
        </div>
      </div>
    `;
  }

  function storiesCards(scope, data) {
    const total = storyCityIds().length;
    if (scope === "state") {
      const items = storyCityList(String(data.id || ""));
      const cards = [
        { label: "Histórias na UF", value: items.length ? formatNumber(items.length) : "Ainda não" },
        { label: "Piloto nacional", value: `${formatNumber(total)} municípios` }
      ];
      if (items.length) cards.push({ label: "Municípios", value: storyListHtml(items), isHtml: true });
      return cards;
    }
    if (scope === "city") {
      const story = storyForCity(data.id);
      if (!story) {
        return [
          { label: "História", value: "Ainda não escrita" },
          { label: "Piloto", value: `${formatNumber(total)} municípios com história` },
          { label: "Município", value: `${data.name || ""} (${data.uf || ""})` }
        ];
      }
      return [
        { isHtml: true, value: storyCardHtml(story) },
        { label: "População", value: formatNumber(data.pop || 0) }
      ];
    }
    const items = storyCityList(null);
    return [
      { label: "Piloto", value: `${formatNumber(total)} municípios com história` },
      { label: "Como é feito", value: "IA + dados IBGE" },
      { label: "Municípios do piloto", value: storyListHtml(items), isHtml: true }
    ];
  }

  function analysisNote() {
    const config = activeAnalysisConfig();
    const projectionWarning = activeAnalysis === "gdp" && parseInt(activeGdpYear, 10) > parseInt(LATEST_OFFICIAL_GDP_YEAR, 10)
      ? ` Ano ${activeGdpYear} marcado como projeção local.`
      : "";
    const hdiWarning = activeAnalysis === "hdi"
      ? ` Ano ativo: ${resolveHdiYear() || "N/D"}.${activeView === "cities" ? " Em municípios, o valor é proxy por UF, não IDHM municipal real." : ""}`
      : "";
    const securityWarning = activeAnalysis === "security"
      ? ` Indicador ativo: ${activeSecuritySubMetric || "mviRate"}.${activeView === "cities" ? " Em municípios, prioriza dado IPEA Atlas; quando ausente, usa proxy UF." : ""}`
      : "";
    const healthWarning = activeAnalysis === "health"
      ? ` Indicador ativo: ${activeHealthSubMetric || "bedsPer1000"}.${activeView === "cities" ? " Em municípios, usa dado municipal quando disponível; quando ausente, usa proxy UF." : ""}`
      : "";
    const ipsComparability = activeAnalysis === "ips" && ipsBrazilData && availableIpsYears.length > 1
      ? ` As edições ${availableIpsYears.slice().reverse().join(", ")} não são estritamente comparáveis entre si (mudaram indicadores e tratamentos estatísticos); para tendência, use a série recalculada do Brasil no card de histórico.${isLatestIpsYear() ? "" : ` A edição ${ipsEdition()} não é a vigente: nela as UFs vêm da agregação municipal ponderada, já que só o relatório da edição vigente está integrado.`}`
      : "";
    const ipsWarning = activeAnalysis === "ips"
      ? ` Edição ${ipsEdition() || "N/D"}.${activeView === "cities" ? (ipsCityCount() ? ` IPS municipal oficial dos ${formatNumber(ipsCityCount())} municípios.` : " Em municípios, o valor é proxy pela UF.") : ""}${activeView === "world" ? " No Globo não há camada de IPS: o IPS Brasil é índice nacional/municipal e não é comparável ao IPS Global (Brasil marca 72,74 no Global 2026 e 63,40 no IPS Brasil 2026)." : ""}${ipsComparability}`
      : "";
    return `${config.note}${projectionWarning}${hdiWarning}${securityWarning}${healthWarning}${ipsWarning} Fonte/procedência: ${sourceDetailsLine()}.`;
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
    if (activeAnalysis === "ips") {
      const metricConfig = ANALYSIS_CATALOG.ips.metrics[activeIpsSubMetric] || ANALYSIS_CATALOG.ips.metrics.ipsGeral;
      const field = ipsMetricField();
      return {
        title: `Estados por ${metricConfig.metric} ${ipsEdition()}`,
        caption: "maior pontuação | top 10",
        value: (row) => row[field] || 0,
        format: formatIps
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
    if (activeAnalysis === "stories") {
      return {
        title: "Estados com histórias escritas",
        caption: "piloto | 10 municípios",
        value: (row) => storyCityIds().filter((id) => id.startsWith(row.id)).length,
        format: (v) => v === 1 ? "1 história" : `${v} histórias`
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
    if (activeAnalysis === "health") {
      const metric = activeHealthSubMetric || "bedsPer1000";
      const metricTitles = {
        bedsPer1000: "leitos",
        icuBedsPer100k: "UTI",
        doctorsPer1000: "medicos",
        infantMortality: "mortalidade infantil",
        vaccinationCoverage: "vacinacao"
      };
      const formatMap = {
        bedsPer1000: (v) => `${v.toFixed(1)} /1k`,
        icuBedsPer100k: (v) => `${v.toFixed(1)} /100k`,
        doctorsPer1000: (v) => `${v.toFixed(1)} /1k`,
        infantMortality: (v) => `${v.toFixed(1)} /1k NV`,
        vaccinationCoverage: (v) => `${v.toFixed(1)}%`
      };
      return {
        title: `Estados por ${metricTitles[metric] || "saude"}`,
        caption: metric === "infantMortality" ? "maiores taxas | top 10" : "maiores indicadores | top 10",
        value: (row) => row[healthMetricField()] || 0,
        format: formatMap[metric] || ((v) => v.toFixed(1))
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
        title: `Municípios por PIB por habitante de ${uf}`,
        caption: "mais ricas | top 10",
        value: (row) => perCapita(row.gdp, row.pop),
        format: formatCurrencyShort
      };
    }
    if (activeAnalysis === "hdi") {
      return {
        title: `Municípios por IDHM de ${uf}`,
        caption: "proxy pela UF; não é ranking municipal real",
        value: (row) => row.hdi || 0,
        format: (v) => `${formatHdi(v)} proxy`
      };
    }
    if (activeAnalysis === "ips") {
      const hasCityData = ipsCityCount() > 0;
      const metricConfig = ANALYSIS_CATALOG.ips.metrics[activeIpsSubMetric] || ANALYSIS_CATALOG.ips.metrics.ipsGeral;
      const field = ipsMetricField();
      return {
        title: `Municípios de ${uf} por ${metricConfig.metric}`,
        caption: hasCityData ? `municipal ${ipsEdition()} | top 10` : "proxy pela UF; não é ranking municipal real",
        value: (row) => row[field] || 0,
        format: (value) => (hasCityData ? formatIps(value) : `${formatIps(value)} proxy`)
      };
    }
    if (activeAnalysis === "politics") {
      return {
        title: `Municípios por habitantes por político de ${uf}`,
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
        title: `${title} — municípios de ${uf}`,
        caption: metric === "mviRate" ? "IPEA + proxy UF quando ausente" : "proxy pela UF",
        value: (row) => row[metric] || 0,
        format: (v) => `${v.toFixed(1)} por 100k`
      };
    }
    if (activeAnalysis === "health") {
      const metric = activeHealthSubMetric || "bedsPer1000";
      const metricTitles = {
        bedsPer1000: "leitos",
        icuBedsPer100k: "UTI",
        doctorsPer1000: "medicos",
        infantMortality: "mortalidade infantil",
        vaccinationCoverage: "vacinacao"
      };
      return {
        title: `Saúde — municípios de ${uf}`,
        caption: `${metricTitles[metric] || "indicador"} municipal quando disponivel; fallback UF`,
        value: (row) => row[healthMetricField()] || 0,
        format: (v) => metric === "vaccinationCoverage" ? `${v.toFixed(1)}%` : `${v.toFixed(1)}`
      };
    }
    if (activeAnalysis === "education") {
      return {
        title: `ENEM ${ENEM_STATES_YEAR} — municípios de ${uf}`,
        caption: `maiores médias (estimativas projetadas) | top 10`,
        value: (row) => row.enemScore || 0,
        format: (v) => v ? `${v.toFixed(1)} pts` : "-"
      };
    }
    if (activeAnalysis === "travel") {
      return {
        title: `Municípios documentados em ${uf}`,
        caption: "por população",
        value: (row) => DOCUMENTED_CITIES[row.id] ? row.pop : 0,
        format: formatShort
      };
    }
    if (activeAnalysis === "stories") {
      return {
        title: `Municípios com história em ${uf}`,
        caption: "piloto | clique para ler",
        value: (row) => storyForCity(row.id) ? row.pop : 0,
        format: formatShort
      };
    }
    return {
      title: `Maiores municípios de ${uf}`,
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
    elements["ranking-title"].textContent = activeAnalysis === "general" ? `Municípios de ${uf}` : config.title;
    elements["ranking-caption"].textContent = `${collection.features.length} municípios`;
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
    elements["ranking-title"].textContent = "Municípios em foco";
    elements["ranking-caption"].textContent = "selecione uma UF";
    const text = message || "Clique em um estado no mapa ou use a busca para carregar os municípios da UF.";
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
      applySseBarStyles();
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
      applySseBarStyles();
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
      applySseBarStyles();
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
      applySseBarStyles();
    }
  }

  function showMunicipalityPopup(lngLat, props) {
    const rows = municipalityPopupRows(props);
    showFixedDetailCard("Município", props.name, rows, props);
    if (window.lucide) window.lucide.createIcons();
  }

  function showMunicipalityHover(lngLat, props) {
    if (isStreetMode || !hoverCardsEnabled) return;
    const key = `${props.stateId || ""}:${props.id || ""}`;
    const html = popupHtml("Município", props.name, municipalityPopupRows(props));

    if (!hoverPopup) {
      hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        className: "hover-popup"
      }).setLngLat(lngLat).setHTML(html).addTo(map);
      hoveredFeatureKey = key;
      applySseBarStyles();
      return;
    }

    hoverPopup.setLngLat(lngLat);
    if (hoveredFeatureKey !== key) {
      hoverPopup.setHTML(html);
      hoveredFeatureKey = key;
      if (window.lucide) window.lucide.createIcons();
      applySseBarStyles();
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
    if (activeAnalysis === "health") return healthCards("brazil");
    if (activeAnalysis === "sse") return sseCards("brazil");
    if (activeAnalysis === "travel") return travelCards("brazil");
    if (activeAnalysis === "stories") return storiesCards("brazil");
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
    if (activeAnalysis === "ips") return ipsCards("state", stateForCards);
    if (activeAnalysis === "politics") return politicsCards("state", stateForCards);
    if (activeAnalysis === "education") return educationCards("state", stateForCards);
    if (activeAnalysis === "security") return securityCards("state", stateForCards);
    if (activeAnalysis === "health") return healthCards("state", stateForCards);
    if (activeAnalysis === "sse") return sseCards("state", stateForCards);
    if (activeAnalysis === "travel") return travelCards("state", stateForCards);
    if (activeAnalysis === "stories") return storiesCards("state", stateForCards);
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
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShort(props.gdp) },
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
    if (activeAnalysis === "ips") return ipsCards("city", props);
    if (activeAnalysis === "politics") return politicsCards("city", props);
    if (activeAnalysis === "education") return educationCards("city", props);
    if (activeAnalysis === "security") return securityCards("city", props);
    if (activeAnalysis === "health") return healthCards("city", props);
    if (activeAnalysis === "sse") return sseCards("city", props);
    if (activeAnalysis === "travel") return travelCards("city", props);
    if (activeAnalysis === "stories") return storiesCards("city", props);
    const pop = Number(props.pop || 0);
    const stateId = props.stateId || (props.id && String(props.id).length >= 2 ? String(props.id).substring(0, 2) : "");
    const state = stateById.get(String(stateId));
    const gdpPerCapita = perCapita(props.gdp, pop);
    const politics = cityPoliticalSummary(props);
    const area = props.areaKm2;
    return [
      { label: "População", value: formatNumber(pop) },
      { label: "Área territorial", value: formatArea(area) },
      { label: "Densidade pop.", value: formatDensity(area ? pop / area : null) },
      { label: `PIB ${props.gdpYear || ""}`, value: formatCurrencyShort(props.gdp) },
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
    applyGdpHistoryStyles("ips-history-chart");
    applySseBarStyles();

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
    } else if (kind === "Município" && context) {
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

  function refreshActiveViews() {
    refreshAnalysisContent();
    refreshFixedDetailCard();
    updateHeatLegend();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
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

  function normalizeSectorFeatureProperties(feature) {
    const props = feature.properties || {};
    const sectorId = props.sector_id || props.CD_SETOR || props.id || feature.id;
    const bairro = props.bairro || props.bairroNome || props.NM_BAIRRO || null;
    const distrito = props.distrito || props.NM_DISTRI || null;
    feature.id = feature.id || sectorId;
    feature.properties = {
      ...props,
      sector_id: String(sectorId || ""),
      id: String(sectorId || ""),
      CD_SETOR: String(sectorId || ""),
      bairro,
      bairroNome: bairro,
      NM_BAIRRO: bairro,
      distrito,
      NM_DISTRI: distrito,
      bairroGrupo: bairro || (distrito ? `Distrito: ${distrito}` : "Sem bairro oficial"),
      pop: props.pop ?? props.populacao ?? null,
      domicilios: props.domicilios ?? props.dom ?? null
    };
    return feature;
  }

  function sectorIndicatorFallbackCatalog() {
    return [
      { id: "bairro", property: "bairroGrupo", label: "Bairro", unit: "categoria", kind: "categorical", provenance: "official_observed", map: true },
      { id: "populacao", property: "pop", label: "População residente", unit: "habitantes", kind: "count", provenance: "official_observed", map: true },
      { id: "domicilios", property: "domicilios", label: "Total de domicílios", unit: "domicílios", kind: "count", provenance: "official_observed", map: true }
    ];
  }

  function sectorIndicatorsForData(data) {
    if (!data || !Array.isArray(data.features)) return [];
    const catalog = Array.isArray(data.indicators) && data.indicators.length
      ? data.indicators
      : sectorIndicatorFallbackCatalog();
    return catalog.filter((indicator) => {
      if (indicator.map === false) return false;
      if (indicator.kind === "categorical") return true;
      return data.features.some((feature) => Number.isFinite(Number(feature.properties?.[indicator.property])));
    });
  }

  function sectorIndicatorMeta(indicatorId, data = currentSectorData) {
    const indicators = sectorIndicatorsForData(data);
    return indicators.find((indicator) => indicator.id === indicatorId)
      || indicators.find((indicator) => indicator.id === "bairro")
      || indicators[0]
      || null;
  }

  function sectorIndicatorProvenanceNote(indicator) {
    const provenance = String(indicator?.provenance || "");
    if (provenance === "estimated_parent_proxy") return "Proxy municipal ou estadual aplicado ao setor; taxas e índices não foram divididos.";
    if (provenance === "estimated_proportional") return "Estimativa proporcional; o total do território de origem é preservado.";
    if (provenance === "estimated_model") return "Estimativa modelada; o total municipal é preservado.";
    return "Observado ou derivado dos agregados oficiais do Censo 2022.";
  }

  function sectorQuantile(values, probability) {
    if (!values.length) return null;
    const position = (values.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return values[lower];
    return values[lower] + ((values[upper] - values[lower]) * (position - lower));
  }

  function sectorCategoricalEntries(data) {
    const groups = [...new Set((data?.features || []).map((feature) => {
      const props = feature.properties ||= {};
      props.bairroGrupo = props.bairro || props.bairroNome || props.NM_BAIRRO
        || (props.distrito || props.NM_DISTRI ? `Distrito: ${props.distrito || props.NM_DISTRI}` : "Sem bairro oficial");
      return props.bairroGrupo;
    }))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
    return groups.map((group, index) => {
      const hue = Math.round((203 + (index * 137.507764)) % 360);
      return {
        label: String(group),
        color: group === "Sem bairro oficial" ? "#64748b" : `hsl(${hue}, 72%, 52%)`
      };
    });
  }

  function sectorCategoricalColorExpression(data) {
    const categories = sectorCategoricalEntries(data);
    const expression = ["match", ["coalesce", ["get", "bairroGrupo"], "Sem bairro oficial"]];
    categories.forEach((category) => {
      expression.push(category.label, category.color);
    });
    expression.push("#64748b");
    return expression;
  }

  function sectorNumericColorExpression(data, indicator) {
    const values = (data?.features || [])
      .map((feature) => Number(feature.properties?.[indicator.property]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!values.length) return "rgba(100, 116, 139, 0.45)";
    const probabilities = [0, 0.25, 0.5, 0.75, 1];
    const palette = ["#17212b", "#1a5f8a", "#51d1c2", "#f2c14e", "#ff6b73"];
    const stops = [];
    probabilities.forEach((probability, index) => {
      const value = sectorQuantile(values, probability);
      if (!stops.length || value > stops.at(-1).value) stops.push({ value, color: palette[index] });
      else stops.at(-1).color = palette[index];
    });
    if (stops.length === 1) return stops[0].color;
    const interpolation = ["interpolate", ["linear"], ["to-number", ["get", indicator.property]]];
    stops.forEach((stop) => interpolation.push(stop.value, stop.color));
    return ["case", ["all", ["has", indicator.property], ["!=", ["get", indicator.property], null]], interpolation, "rgba(100, 116, 139, 0.35)"];
  }

  function sectorColorExpression(data, indicatorId) {
    const indicator = sectorIndicatorMeta(indicatorId, data);
    return !indicator || indicator.kind === "categorical"
      ? sectorCategoricalColorExpression(data)
      : sectorNumericColorExpression(data, indicator);
  }

  function formatSectorIndicatorValue(value, indicator) {
    const number = Number(value);
    if (value === null || value === undefined || !Number.isFinite(number)) return "Não disponível";
    if (indicator?.kind === "currency") return formatCurrencyShort(number, "BRL");
    if (indicator?.unit === "%") return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    if (indicator?.unit === "por mil hab.") return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}‰`;
    if (indicator?.kind === "average" || indicator?.kind === "rate") {
      return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${indicator.unit || ""}`.trim();
    }
    return `${formatNumber(number)}${indicator?.unit ? ` ${indicator.unit}` : ""}`;
  }

  function renderSectorIndicatorControl() {
    const container = elements["sector-indicator-controls"];
    const select = elements["sector-indicator-select"];
    if (!container || !select) return;
    const indicators = sectorIndicatorsForData(currentSectorData);
    container.hidden = !isStreetMode;
    select.innerHTML = indicators.map((indicator) => (
      `<option value="${escapeHtml(indicator.id)}" ${indicator.id === activeSectorIndicator ? "selected" : ""}>${escapeHtml(indicator.label)}</option>`
    )).join("");
    const meta = sectorIndicatorMeta(activeSectorIndicator);
    if (elements["sector-indicator-note"] && meta) {
      elements["sector-indicator-note"].textContent = `${sectorIndicatorProvenanceNote(meta)} Unidade: ${meta.unit || "não se aplica"}.`;
    }
  }

  function applySectorIndicator(indicatorId) {
    if (!currentSectorData) return;
    const selected = sectorIndicatorMeta(indicatorId);
    if (!selected) return;
    activeSectorIndicator = selected.id;
    if (map.getLayer("setores-fill")) {
      map.setPaintProperty("setores-fill", "fill-color", sectorColorExpression(currentSectorData, activeSectorIndicator));
    }
    renderSectorIndicatorControl();
    updateHeatLegend();
    savePreferences();
  }

  async function flyToStreet(options = {}) {
    isStreetMode = true;
    if (activeView !== "census_tract") setActiveView("census_tract");
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    hideAtlasLayersForStreet();
    restoreBaseLabels();
    elements["hud-layer"].textContent = "Setores";
    currentSectorData = null;
    if (elements["sector-indicator-controls"]) elements["sector-indicator-controls"].hidden = false;

    if (!selectedCityId && selectedStateId && stateCitiesCache.has(selectedStateId)) {
      const largestCity = stateCitiesCache.get(selectedStateId).features[0];
      if (largestCity) {
        selectCity(largestCity.properties.id, largestCity, { fly: false });
      }
    }

    if (!selectedCityId) {
      await loadStateCities("41", "4106902", { preserveCamera: true });
    }

    const state = selectedStateId ? stateById.get(String(selectedStateId)) : null;
    if (!state || !selectedCityId) throw new Error("Selecione um município para visualizar os setores.");
    showStatus("Carregando setores censitários", `Lendo a partição local de ${selectedCityFeature?.properties?.name || selectedCityId}.`);
    try {
      const sectors = await globalThis.AtlasStaticData.loadSectors(state.sigla, selectedCityId);
      sectors.features = sectors.features.map(normalizeSectorFeatureProperties);
      currentSectorData = sectors;
      const indicators = sectorIndicatorsForData(sectors);
      if (!indicators.some((indicator) => indicator.id === activeSectorIndicator)) {
        activeSectorIndicator = indicators.find((indicator) => indicator.id === "bairro")?.id || indicators[0]?.id;
      }

      setLayersVisibility(["setores-fill", "setores-outline"], false);
      if (map.getLayer("setores-fill")) map.removeLayer("setores-fill");
      if (map.getLayer("setores-outline")) map.removeLayer("setores-outline");
      if (map.getSource("setores-source")) map.removeSource("setores-source");
      map.addSource("setores-source", { type: "geojson", data: sectors });
      addLayerOnce({
        id: "setores-fill",
        type: "fill",
        source: "setores-source",
        paint: { "fill-color": sectorColorExpression(sectors, activeSectorIndicator), "fill-opacity": 0.68 }
      }, firstBaseSymbolLayerId());
      addLayerOnce({
        id: "setores-outline",
        type: "line",
        source: "setores-source",
        paint: { "line-color": "rgba(255,255,255,0.45)", "line-width": 0.8 }
      }, firstBaseSymbolLayerId());

      map.off("click", "setores-fill");
      map.on("click", "setores-fill", (event) => {
        const props = event.features[0].properties || {};
        const indicator = sectorIndicatorMeta(activeSectorIndicator);
        const indicatorValue = indicator ? formatSectorIndicatorValue(props[indicator.property], indicator) : "Não disponível";
        const sectorCode = String(props.sector_id || props.id || "Não disponível");
        const rows = [
          { label: "Código", value: sectorCode },
          { label: "Bairro", value: props.bairroGrupo || "Não disponível" },
          { label: "População", value: formatSectorIndicatorValue(props.pop, { unit: "habitantes" }) },
          { label: "Domicílios", value: formatSectorIndicatorValue(props.domicilios, { unit: "domicílios" }) }
        ];
        if (indicator && indicator.id !== "bairro") {
          rows.push({ label: indicator.label, value: indicatorValue });
        }
        rows.push({ label: "Proveniência", value: sectorIndicatorProvenanceNote(indicator) });
        showFixedDetailCard("Setor censitário", sectorCode, rows, props);
      });

      renderSectorIndicatorControl();
      updateHeatLegend();
      if (!options.preserveCamera && sectors.bbox) {
        map.fitBounds([[sectors.bbox[0], sectors.bbox[1]], [sectors.bbox[2], sectors.bbox[3]]], { padding: 50, duration: 900, essential: true });
      }
    } finally {
      hideStatus();
    }

    if (options.preserveCamera) {
      savePreferences();
      return;
    }
    savePreferences();
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

    const currencyButton = document.querySelector(`[data-currency="${activeCurrency}"]`);
    if (currencyButton) setActiveButton("[data-currency]", currencyButton);

    setHoverCardsEnabled(hoverCardsEnabled);
    setBubblesEnabled(bubblesEnabled);
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

  function setBubblesEnabled(enabled) {
    bubblesEnabled = Boolean(enabled);
    const button = elements["bubbles-toggle"];
    if (button) {
      button.classList.toggle("active", bubblesEnabled);
      button.setAttribute("aria-pressed", String(bubblesEnabled));
      button.title = bubblesEnabled
        ? "Ocultar bolhas proporcionais"
        : "Exibir bolhas proporcionais";
    }
    if (map && map.getStyle()) syncAtlasLayersForActiveView();
  }

  function savePreferences() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        hoverCards: hoverCardsEnabled,
        bubbles: bubblesEnabled,
        base: activeBaseMode,
        projection: activeProjection,
        analysis: activeAnalysis,
        gdpSubMetric: activeGdpSubMetric,
        hdiYear: activeHdiYear,
        securitySubMetric: activeSecuritySubMetric,
        healthSubMetric: activeHealthSubMetric,
        ipsSubMetric: activeIpsSubMetric,
        ipsYear: activeIpsYear,
        sectorIndicator: activeSectorIndicator,
        sourceSelections: activeSourceSelections,
        worldMetric: activeWorldMetric,
        view: activeView,
        currency: activeCurrency,
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
      if (typeof parsed.bubbles === "boolean") safe.bubbles = parsed.bubbles;
      if (validBaseMode(parsed.base)) safe.base = parsed.base;
      if (validProjection(parsed.projection)) safe.projection = parsed.projection;
      if (validAnalysis(parsed.analysis)) safe.analysis = parsed.analysis;
      if (validView(parsed.view)) safe.view = parsed.view;
      if (validWorldMetric(parsed.worldMetric)) safe.worldMetric = parsed.worldMetric;
      if (parsed.currency === "BRL" || parsed.currency === "USD") safe.currency = parsed.currency;
      if (typeof parsed.sectorIndicator === "string" && parsed.sectorIndicator) safe.sectorIndicator = parsed.sectorIndicator;

      if (parsed.selectedStateId) safe.selectedStateId = normalizeCode(parsed.selectedStateId);
      if (parsed.selectedCityId) safe.selectedCityId = normalizeCode(parsed.selectedCityId);
      if (validAnalysisMetric("gdp", parsed.gdpSubMetric)) safe.gdpSubMetric = String(parsed.gdpSubMetric);
      if (parsed.hdiYear) safe.hdiYear = String(parsed.hdiYear);
      if (validAnalysisMetric("security", parsed.securitySubMetric)) safe.securitySubMetric = String(parsed.securitySubMetric);
      if (validAnalysisMetric("health", parsed.healthSubMetric)) safe.healthSubMetric = String(parsed.healthSubMetric);
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
    return ["world", "states", "cities", "census_tract"].includes(view);
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
    const polygons = geometry && geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry && geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    if (polygons.length) {
      const polygon = polygons.reduce((largest, candidate) => {
        if (!largest) return candidate;
        return Math.abs(ringSignedArea(candidate[0])) > Math.abs(ringSignedArea(largest[0])) ? candidate : largest;
      }, null);
      const outerRing = polygon && polygon[0];
      if (outerRing && outerRing.length >= 3) {
        const centroid = ringCentroid(outerRing);
        if (centroid && pointInsidePolygon(centroid, polygon)) return centroid;

        const bounds = coordinateBounds(outerRing);
        if (bounds) {
          const middle = [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
          if (pointInsidePolygon(middle, polygon)) return middle;

          let best = null;
          let bestDistance = Infinity;
          const divisions = 32;
          for (let x = 0; x < divisions; x += 1) {
            for (let y = 0; y < divisions; y += 1) {
              const candidate = [
                bounds.minLng + ((x + 0.5) / divisions) * (bounds.maxLng - bounds.minLng),
                bounds.minLat + ((y + 0.5) / divisions) * (bounds.maxLat - bounds.minLat)
              ];
              if (!pointInsidePolygon(candidate, polygon)) continue;
              const distance = ((candidate[0] - middle[0]) ** 2) + ((candidate[1] - middle[1]) ** 2);
              if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
              }
            }
          }
          if (best) return best;
        }
        const firstValid = outerRing.find(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
        if (firstValid) return [firstValid[0], firstValid[1]];
      }
    }

    const coords = flattenCoordinates(geometry);
    const bounds = coordinateBounds(coords);
    return bounds ? [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2] : null;
  }

  function coordinateBounds(coordinates) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    coordinates.forEach(([lng, lat]) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
    return Number.isFinite(minLng) ? { minLng, minLat, maxLng, maxLat } : null;
  }

  function ringSignedArea(ring) {
    if (!Array.isArray(ring)) return 0;
    let twiceArea = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      twiceArea += (current[0] * next[1]) - (next[0] * current[1]);
    }
    return twiceArea / 2;
  }

  function ringCentroid(ring) {
    let crossSum = 0;
    let lngSum = 0;
    let latSum = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const cross = (current[0] * next[1]) - (next[0] * current[1]);
      crossSum += cross;
      lngSum += (current[0] + next[0]) * cross;
      latSum += (current[1] + next[1]) * cross;
    }
    if (Math.abs(crossSum) < 1e-12) return null;
    return [lngSum / (3 * crossSum), latSum / (3 * crossSum)];
  }

  function pointInsidePolygon(point, polygon) {
    if (!polygon || !polygon.length || !pointInsideRing(point, polygon[0])) return false;
    return !polygon.slice(1).some((hole) => pointInsideRing(point, hole));
  }

  function pointInsideRing([lng, lat], ring) {
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
      const [currentLng, currentLat] = ring[current];
      const [previousLng, previousLat] = ring[previous];
      const crosses = (currentLat > lat) !== (previousLat > lat)
        && lng < ((previousLng - currentLng) * (lat - currentLat)) / ((previousLat - currentLat) || Number.EPSILON) + currentLng;
      if (crosses) inside = !inside;
    }
    return inside;
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

  // Converte valor original do IBGE (que é BRL) para a moeda ativa
  function getBrlValueInActiveCurrency(valueInBrl) {
    const val = Number(valueInBrl || 0);
    if (activeCurrency === "USD") {
      return val / USD_BRL_RATE;
    }
    return val;
  }

  // Converte valor original global (que é USD) para a moeda ativa
  function getUsdValueInActiveCurrency(valueInUsd) {
    const val = Number(valueInUsd || 0);
    if (activeCurrency === "BRL") {
      return val * USD_BRL_RATE;
    }
    return val;
  }

  function formatCurrency(value, originalUnit = "BRL") {
    const originalValue = Number(value || 0);
    if (!originalValue) return "-";
    
    const convertedValue = originalUnit === "BRL" 
      ? getBrlValueInActiveCurrency(originalValue)
      : getUsdValueInActiveCurrency(originalValue);

    if (activeCurrency === "BRL") {
      const numOnly = convertedValue.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
      return `R$ ${numOnly}`;
    } else {
      const numOnly = convertedValue.toLocaleString("en-US", { maximumFractionDigits: 0 });
      return `US$ ${numOnly}`;
    }
  }

  function formatCurrencyShort(value, originalUnit = "BRL") {
    const originalValue = Number(value || 0);
    if (!originalValue) return "-";

    const convertedValue = originalUnit === "BRL" 
      ? getBrlValueInActiveCurrency(originalValue)
      : getUsdValueInActiveCurrency(originalValue);

    const abs = Math.abs(convertedValue);
    
    if (activeCurrency === "BRL") {
      if (abs >= 1000000000000) return `R$ ${(convertedValue / 1000000000000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tri`;
      if (abs >= 1000000000) return `R$ ${(convertedValue / 1000000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
      if (abs >= 1000000) return `R$ ${(convertedValue / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
      return formatCurrency(convertedValue, activeCurrency);
    } else {
      if (abs >= 1000000000000) return `US$ ${(convertedValue / 1000000000000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tri`;
      if (abs >= 1000000000) return `US$ ${(convertedValue / 1000000000).toLocaleString("en-US", { maximumFractionDigits: 1 })} bi`;
      if (abs >= 1000000) return `US$ ${(convertedValue / 1000000).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`;
      return formatCurrency(convertedValue, activeCurrency);
    }
  }

  function formatCurrencyUSD(value) {
    return formatCurrency(value, "USD");
  }

  function formatCurrencyShortUSD(value) {
    return formatCurrencyShort(value, "USD");
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
    const healthWorldSourceIds = activeAnalysis === "health" ? activeDataSourceIds() : ["healthGlobalWho"];
    updateSourceDisplays(activeAnalysis === "hdi" ? worldHdiSourceIds : (activeAnalysis === "security" ? securityWorldSourceIds : (activeAnalysis === "health" ? healthWorldSourceIds : ["localWorldJson"])));
    const hdiYear = resolveHdiYear("world");
    const globalHdiCount = globalHdiDataset && globalHdiDataset.countries ? Object.keys(globalHdiDataset.countries).length : 0;
    const globalSecurityCount = securityGlobalData && securityGlobalData.countries ? Object.keys(securityGlobalData.countries).length : 0;
    const globalHealthCount = healthGlobalData && healthGlobalData.countries ? Object.keys(healthGlobalData.countries).length : 0;
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
        ...(activeAnalysis === "health" ? [
          { label: "Saúde global", value: globalHealthCount ? `${formatNumber(globalHealthCount)} países na base` : "carregando" },
          { label: "Indicador ativo", value: healthMetricsForActiveView()[activeHealthSubMetric]?.label || "UHC" },
          { label: "Fonte", value: compactSourceLine(healthWorldSourceIds) }
        ] : []),
        { label: "Arquivo local", value: activeAnalysis === "hdi" ? (activeSourceOptionId("hdi", "world") === "owid" ? "hdi_owid.parquet" : "hdi_global.parquet") : (activeAnalysis === "security" ? "security_global.parquet" : (activeAnalysis === "health" ? "health_global.parquet" : "world_data.parquet")) },
        { label: "Origem original", value: activeAnalysis === "hdi" ? upstreamSourceLine(sourceRecords(worldHdiSourceIds)[0]) : (activeAnalysis === "security" ? upstreamSourceLine(DATA_SOURCE_CATALOG.securityGlobalUnodc) : (activeAnalysis === "health" ? upstreamSourceLine(DATA_SOURCE_CATALOG.healthGlobalWho) : upstreamSourceLine(DATA_SOURCE_CATALOG.localWorldJson))) }
    ]);
    elements["general-note"].textContent = activeAnalysis === "hdi"
      ? `IDH global carregado de Parquet local auditável. Fonte/procedência: ${sourceDetailsLine(worldHdiSourceIds)}.`
      : (activeAnalysis === "security"
        ? `Dados de segurança global carregados de Parquet local. Fonte/procedência: ${sourceDetailsLine(["securityGlobalUnodc"])}.`
        : (activeAnalysis === "health"
          ? `Dados globais de saúde carregados de Parquet local compilado. Fonte/procedência: ${sourceDetailsLine(healthWorldSourceIds)}.`
          : `Dados globais carregados de GeoParquet local. Fonte/procedência: ${sourceDetailsLine(["localWorldJson"])}.`));
  }

  async function enterWorldMode(options = {}) {
    isStreetMode = false;
    clearHoverPopup();
    if (fixedPopup) fixedPopup.remove();
    fixedPopup = null;
    selectedStateId = null;
    selectedCityId = null;
    
    if (!map.getSource("world-fill-source")) {
        showStatus("Carregando mapa-múndi", "Lendo o Parquet global local...");
        try {
            if (!worldFeatureCollection) throw new Error("Parquet global não carregado.");
            hydrateWorldHdi(worldFeatureCollection);
            hydrateWorldSecurity(worldFeatureCollection);
            hydrateWorldHealth(worldFeatureCollection);
            
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
               scheduleCountryClick(event.lngLat, props, fullFeature);
            });
            map.on("dblclick", "world-fill", (event) => {
               if (activeView !== "world" || !event.features.length) return;
               if (event.preventDefault) event.preventDefault();
               const props = event.features[0].properties;
               if (String(props.ISO_A3 || "").toUpperCase() !== "BRA") return;
               clearPendingCountryClick();
               clearHoverPopup();
               if (fixedPopup) fixedPopup.remove();
               fixedPopup = null;
               setActiveView("states");
               enterStateAnalysisMode({ selectBrazil: true });
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
    if (!options.preserveCamera) map.flyTo({ center: BR_CENTER, zoom: 1.5, speed: 0.8, curve: 1.35, essential: true });
    
    elements["hud-layer"].textContent = "Globo";
    elements["metric-state"].textContent = "Mundo";
    elements["metric-state-pop"].textContent = "8.000.000.000";
    elements["metric-city"].textContent = "nenhum";
    elements["metric-city-pop"].textContent = "selecione um país";

    renderSelectedWorld();
    if (window.updateWorldLayerColor) window.updateWorldLayerColor();
    applyBaseModeToAtlasLayers();
    updateHeatLegend();
    savePreferences();
  }

  function selectCountry(props, feature) {
    props = feature && feature.properties ? { ...props, ...feature.properties } : props;
    const worldHdiSourceIds = activeDataSourceIds();
    const securityWorldSourceIds = activeAnalysis === "security" ? activeDataSourceIds() : ["securityGlobalUnodc"];
    const healthWorldSourceIds = activeAnalysis === "health" ? activeDataSourceIds() : ["healthGlobalWho"];
    updateSourceDisplays(activeAnalysis === "hdi" ? worldHdiSourceIds : (activeAnalysis === "security" ? securityWorldSourceIds : (activeAnalysis === "health" ? healthWorldSourceIds : ["localWorldJson"])));
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
        ...(activeAnalysis === "health" ? [
          { label: `UHC ${props.healthYear || 2022}`, value: props.uhcIndex ? `${props.uhcIndex.toFixed(1)}` : "sem dado" },
          { label: "Expectativa de vida", value: props.lifeExpectancy ? `${props.lifeExpectancy.toFixed(1)} anos` : "sem dado" },
          { label: "Leitos hospitalares", value: props.hospitalBedsPer10000 ? `${props.hospitalBedsPer10000.toFixed(1)} por 10k` : "sem dado" },
          { label: "Médicos", value: props.physiciansPer10000 ? `${props.physiciansPer10000.toFixed(1)} por 10k` : "sem dado" },
          { label: "Gasto em saúde", value: props.healthExpPctGdp ? `${props.healthExpPctGdp.toFixed(1)}% do PIB` : "sem dado" },
          { label: "Fonte", value: props.healthSource || "WHO/WDI/IHME" }
        ] : []),
        { label: "PIB (2024)", value: formatCurrencyShortUSD(props.gdp) },
        { label: "PIB por habitante", value: formatCurrencyUSD(perCapita(props.gdp, props.pop)) },
        { label: "Região", value: props.region || "Global" },
        { label: "Origem do JSON", value: activeAnalysis === "hdi" ? upstreamSourceLine(sourceRecords(worldHdiSourceIds)[0]) : (activeAnalysis === "security" ? upstreamSourceLine(sourceRecords(securityWorldSourceIds)[0]) : (activeAnalysis === "health" ? upstreamSourceLine(sourceRecords(healthWorldSourceIds)[0]) : upstreamSourceLine(DATA_SOURCE_CATALOG.localWorldJson))) }
    ]);
    elements["general-note"].textContent = activeAnalysis === "hdi"
      ? `IDH global. Fonte/procedência: ${sourceDetailsLine(worldHdiSourceIds)}.`
      : (activeAnalysis === "security"
        ? `Dados de segurança global. Fonte/procedência: ${sourceDetailsLine(securityWorldSourceIds)}.`
        : (activeAnalysis === "health"
          ? `Dados globais de saúde. Fonte/procedência: ${sourceDetailsLine(healthWorldSourceIds)}.`
          : `Dados globais carregados de GeoParquet local. Fonte/procedência: ${sourceDetailsLine(["localWorldJson"])}.`));
  }

  function showCountryHover(lngLat, props) {
    if (!hoverCardsEnabled) return;

    if (activeAnalysis === "hdi" && props && props.hdiHistory) {
      const year = resolveHdiYear("world");
      props = {
        ...props,
        hdi: hdiValueForYear(props.hdiHistory, year),
        hdiYear: year
      };
    }

    const name = props.name_pt || props.ADMIN || props.name || "Desconhecido";
    
    const rows = [
      { label: "População", value: formatShort(props.pop || 0) },
      { label: "Área territorial", value: formatArea(props.areaKm2) },
      { label: "PIB (2024)", value: formatCurrencyShortUSD(props.gdp) },
      { label: "PIB por hab.", value: formatCurrencyUSD(perCapita(props.gdp, props.pop)) },
      ...(activeAnalysis === "hdi" ? [
        { label: `IDH ${props.hdiYear || resolveHdiYear("world")}`, value: formatHdi(props.hdi) }
      ] : []),
      ...(activeAnalysis === "security" ? (() => {
        const sourceId = activeSourceOptionId("security", "world");
        if (sourceId === "gpi") {
          return [
            { label: "GPI", value: props.gpiScore ? props.gpiScore.toFixed(2) : "-" },
            { label: "Ranking GPI", value: props.gpiRank ? `${props.gpiRank}º` : "-" }
          ];
        }
        return [
          { label: "Homicídios", value: props.homicideRate ? `${props.homicideRate.toFixed(1)} /100k` : "-" }
        ];
      })() : []),
      ...(activeAnalysis === "health" ? [
        { label: "UHC", value: props.uhcIndex ? props.uhcIndex.toFixed(1) : "-" },
        { label: "Expectativa de vida", value: props.lifeExpectancy ? `${props.lifeExpectancy.toFixed(1)} anos` : "-" },
        { label: "Leitos hospitalares", value: props.hospitalBedsPer10000 ? `${props.hospitalBedsPer10000.toFixed(1)} /10k` : "-" }
      ] : [])
    ];

    const html = popupHtml("País", `${name} (${props.ISO_A3})`, rows);
    const key = `country:${props.ISO_A3 || ""}`;

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
      ...(activeAnalysis === "health" ? [
        { label: `UHC ${props.healthYear || 2022}`, value: props.uhcIndex ? `${props.uhcIndex.toFixed(1)}` : "sem dado" },
        { label: "Expectativa de vida", value: props.lifeExpectancy ? `${props.lifeExpectancy.toFixed(1)} anos` : "sem dado" },
        { label: "HALE", value: props.healthyLifeExpectancy ? `${props.healthyLifeExpectancy.toFixed(1)} anos saudáveis` : "sem dado" },
        { label: "Leitos hospitalares", value: props.hospitalBedsPer10000 ? `${props.hospitalBedsPer10000.toFixed(1)} por 10k` : "sem dado" },
        { label: "Médicos", value: props.physiciansPer10000 ? `${props.physiciansPer10000.toFixed(1)} por 10k` : "sem dado" },
        { label: "Fonte", value: props.healthSource || "WHO/WDI/IHME" }
      ] : []),
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
        0.35, "#ff3b3b",
        0.55, "#ef7d60",
        0.7, "#f2c14e",
        0.8, "#a9d65c",
        0.9, "#17212b"
      ];
    } else if (activeWorldMetric === "pop") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "pop"], 0],
        0, "#ff3b3b",
        1000000, "#ef7d60",
        10000000, "#f2c14e",
        50000000, "#5b8e54",
        200000000, "#25534e",
        1000000000, "#17212b"
      ];
    } else if (activeWorldMetric === "area") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "areaKm2"], 0],
        0, "#ff3b3b",
        10000, "#ef7d60",
        100000, "#f2c14e",
        500000, "#5b8e54",
        2000000, "#25534e",
        10000000, "#17212b"
      ];
    } else if (activeWorldMetric === "density") {
      colorExpr = [
        "interpolate", ["linear"], 
        ["/", ["to-number", ["get", "pop"], 0], ["max", ["to-number", ["get", "areaKm2"], 1], 1]],
        0, "#ff3b3b",
        10, "#ef7d60",
        50, "#f2c14e",
        150, "#5b8e54",
        500, "#25534e",
        1000, "#17212b"
      ];
    } else if (activeWorldMetric === "gdp") {
      colorExpr = [
        "interpolate", ["linear"], ["to-number", ["get", "gdp"], 0],
        0, "#ff3b3b",
        10000000000, "#ef7d60",
        100000000000, "#f2c14e",
        500000000000, "#5b8e54",
        2000000000000, "#25534e",
        10000000000000, "#17212b"
      ];
    } else if (activeWorldMetric === "gdpPerCapita") {
      colorExpr = [
        "interpolate", ["linear"], 
        ["/", ["to-number", ["get", "gdp"], 0], ["max", ["to-number", ["get", "pop"], 1], 1]],
        0, "#ff3b3b",
        2000, "#ef7d60",
        5000, "#f2c14e",
        15000, "#5b8e54",
        35000, "#25534e",
        60000, "#17212b"
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
    if (activeAnalysis === "health") {
      const metric = healthMetricField();
      if (activeHealthSubMetric === "lifeExpectancy") {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", metric], 0],
          55, "#ff3b3b",
          65, "#ef7d60",
          72, "#f2c14e",
          78, "#a9d65c",
          84, "#17212b"
        ];
      } else if (activeHealthSubMetric === "hospitalBedsPer10000") {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", metric], 0],
          5, "#ff3b3b",
          15, "#ef7d60",
          30, "#f2c14e",
          60, "#a9d65c",
          100, "#17212b"
        ];
      } else if (activeHealthSubMetric === "doctorsPer1000") {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", metric], 0],
          5, "#ff3b3b",
          15, "#ef7d60",
          25, "#f2c14e",
          40, "#a9d65c",
          55, "#17212b"
        ];
      } else {
        colorExpr = [
          "interpolate", ["linear"], ["to-number", ["get", metric], 0],
          40, "#ff3b3b",
          60, "#ef7d60",
          75, "#f2c14e",
          85, "#a9d65c",
          92, "#17212b"
        ];
      }
    }
    map.setPaintProperty("world-fill", "fill-color", colorExpr);
  }

  if (typeof globalThis !== "undefined") {
    globalThis.TestUtils = {
      escapeHtml,
      normalizeCode,
      parseNumber,
      clampNumber,
      normalizeText,
      sseScores,
      formatCurrency,
      formatCurrencyShort,
      formatCurrencyUSD,
      formatCurrencyShortUSD,
      getBrlValueInActiveCurrency,
      getUsdValueInActiveCurrency,
      getActiveCurrency: () => activeCurrency,
      setActiveCurrency: (curr) => { activeCurrency = curr; },
      USD_BRL_RATE,
      formatIps,
      ipsMetricField,
      ipsEdition,
      mergeIpsBrazil,
      mergeIpsBrazilCities,
      cityMapPropertiesForTests: cityMapProperties,
      getStateById: (id) => stateById.get(String(id)),
      seedStateForTests: (state) => { stateById.set(String(state.id), state); },
      setActiveAnalysis: (analysis) => { activeAnalysis = analysis; },
      setActiveIpsSubMetric: (metric) => { activeIpsSubMetric = metric; },
      setActiveIpsYear: (year) => { activeIpsYear = String(year); syncIpsToActiveYear(); },
      getAvailableIpsYears: () => availableIpsYears.slice(),
      ipsClassBreaks,
      territoryHeatColorExpression,
      dropIpsClassBreaksForTests: () => {
        if (ipsBrazilData) delete ipsBrazilData.classBreaks;
        ipsDerivedBreaks.clear();
      },
      analysisMetricExpression
    };
  }

})();
