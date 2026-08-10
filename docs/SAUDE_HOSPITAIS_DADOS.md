# Fontes recomendadas para a aba Saude / Hospitais

Este texto serve como briefing para uma IA ou para quem for implementar a analise no site. A ideia e montar um panorama comparavel entre paises no globo e, ao entrar no Brasil, abrir o detalhe por Brasil, Unidades da Federacao e municipios.

## Decisao principal

Use duas camadas de dados:

1. **Comparacao mundial:** indicadores padronizados por pais. A fonte primaria deve ser a OMS/WHO Global Health Observatory. O Banco Mundial/WDI pode ser usado como fonte alternativa ou API mais simples, mas varios indicadores dele derivam da propria OMS, ONU e fontes nacionais.
2. **Detalhe brasileiro:** indicadores administrativos do SUS/DATASUS, CNES, SIM, SINASC, SIH/SUS, SI-PNI, ANS, SIOPS/FNS e populacao do IBGE. Para municipio, prefira dado administrativo por codigo IBGE de 7 digitos.

Nao use um unico indicador para dizer se a saude e "boa" ou "ruim". O panorama deve combinar resultado de saude, acesso, capacidade instalada, profissionais, prevencao e financiamento.

## Fontes globais

### 1. WHO Global Health Observatory - fonte primaria mundial

- Link geral: https://www.who.int/data/gho
- Indicadores: https://www.who.int/data/gho/data/indicators/indicators-index
- API Athena: https://www.who.int/data/gho/info/athena-api/GHO
- API OData: https://www.who.int/data/gho/info/gho-odata-api
- Escopo: paises, regioes OMS e agregados globais.
- Periodicidade: varia por indicador. Leitos hospitalares tem disseminacao esperada a cada 2-3 anos; profissionais de saude tende a ter atualizacao anual quando o pais reporta.

Indicadores recomendados:

- `hospital_beds_per_10000`: leitos hospitalares por 10.000 habitantes. Indicador WHO: "Hospital beds (per 10 000 population)", codigo Athena conhecido: `10WHS6_102`. Usar para capacidade fisica hospitalar. A propria OMS alerta que nao existe norma global unica para densidade ideal de leitos.
- `medical_doctors_per_10000`: medicos por 10.000 habitantes. Indicador WHO: "Medical doctors (per 10 000 population)", codigo usado em bases WHO/HWF: `HWF_0001`. Mede forca de trabalho, mas pode misturar medicos ativos com registrados dependendo do pais.
- `nursing_midwifery_per_10000`: enfermagem e obstetricia por 10.000 habitantes. Indicador WHO: "Nursing and midwifery personnel (per 10 000 population)".
- `uhc_service_coverage_index`: indice de cobertura de servicos essenciais de saude, escala 0 a 100. Indicador WHO: "UHC Service Coverage Index (SDG 3.8.1)", short name `UHC_INDEX_REPORTED`. Bom indicador sintetico de acesso/cobertura.
- `life_expectancy`: expectativa de vida ao nascer. Bom resultado geral, mas muito influenciado por renda, violencia, envelhecimento e ambiente.
- `hale`: expectativa de vida saudavel ao nascer. Melhor que expectativa de vida simples para medir anos vividos com saude.
- `infant_mortality` e `under5_mortality`: mortalidade infantil e menor de 5 anos por 1.000 nascidos vivos.
- `maternal_mortality`: mortalidade materna por 100.000 nascidos vivos.
- `ncd_mortality_rate`: mortalidade por doencas cronicas nao transmissiveis, preferencialmente padronizada por idade.
- `immunization_measles_dtp3_polio`: cobertura de vacinas sentinela em criancas.
- `out_of_pocket_pct_che` e `catastrophic_health_spending`: peso do gasto direto das familias com saude.

Como pegar:

- Pela API Athena, use o padrao:

```text
https://apps.who.int/gho/athena/api/GHO/{CODIGO}.json?profile=simple&filter=COUNTRY:*
```

- Para um pais especifico:

```text
https://apps.who.int/gho/athena/api/GHO/{CODIGO}.json?profile=simple&filter=COUNTRY:BRA
```

- Para CSV:

```text
https://apps.who.int/gho/athena/api/GHO/{CODIGO}.csv?filter=COUNTRY:*&profile=verbose
```

Use ISO3 para juntar com o mapa-mundi (`BRA`, `USA`, `FRA`). Guarde o ano de referencia de cada indicador, pois a mesma tela pode misturar anos diferentes.

### 2. World Bank World Development Indicators - alternativa mundial com API simples

- Link API: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- API base: https://api.worldbank.org/v2/
- Escopo: paises e agregados regionais.
- Range: muitas series do WDI existem desde 1960, mas indicadores de saude variam muito. Para `SH.MED.BEDS.ZS`, o DataBank informa referencia 1960-2023, com cobertura real diferente por pais.

Indicadores uteis:

- `SH.MED.BEDS.ZS`: hospital beds per 1,000 people.
- `SH.MED.PHYS.ZS`: physicians per 1,000 people.
- `SH.MED.NUMW.P3`: nurses and midwives per 1,000 people.
- `SP.DYN.LE00.IN`: life expectancy at birth.
- `SH.DYN.MORT`: under-5 mortality rate.
- `SH.STA.MMRT`: maternal mortality ratio.
- `SH.XPD.CHEX.GD.ZS`: current health expenditure as % of GDP.
- `SH.XPD.CHEX.PC.CD` ou versao PPP: gasto corrente em saude per capita.
- `SH.XPD.OOPC.CH.ZS`: out-of-pocket expenditure as % of current health expenditure.
- `SH.UHC.SRVS.CV.XD`: UHC service coverage index.

Como pegar:

```text
https://api.worldbank.org/v2/country/all/indicator/SH.MED.BEDS.ZS?format=json&per_page=20000
https://api.worldbank.org/v2/country/BRA/indicator/SP.DYN.LE00.IN?format=json&date=1960:2025
```

Use o Banco Mundial quando a prioridade for facilidade tecnica, paginacao e serie por ISO3. Use a OMS quando a prioridade for fonte primaria de saude.

### 3. IHME / Global Burden of Disease - carga de doenca e causas

- Link: https://vizhub.healthdata.org/gbd-results/
- Documentacao/API IHME: https://api-docs.ihme.services/
- Escopo: mundo, regioes, paises e, em alguns produtos, granularidades subnacionais.
- Range recomendado: GBD 1990-2023 para analises atuais do GBD 2023, quando disponivel.

Indicadores recomendados:

- `dalys_all_causes_age_standardized`: DALYs por 100.000 habitantes, padronizado por idade.
- `death_rate_all_causes_age_standardized`: taxa de mortalidade por todas as causas.
- `top_causes_death`: principais causas de morte por pais.
- `top_causes_daly`: principais causas de perda de saude por pais.
- `risk_attributable_daly`: DALYs atribuidos a fatores de risco: tabagismo, alcool, pressao alta, dieta, poluicao, IMC alto.

Use IHME para explicar "do que as pessoas adoecem ou morrem" e a OMS/Banco Mundial para infraestrutura e cobertura.

## Fontes brasileiras

### 1. CNES / DATASUS - capacidade instalada de saude

- Link TabNet DATASUS: https://datasus.saude.gov.br/informacoes-de-saude-tabnet/
- Link CNES: https://estabelecimentos.datasus.gov.br/pages/consultas.jsp
- Link OpenDataSUS: https://dadosabertos.saude.gov.br
- Link ElastiCNES: https://elasticnes.saude.gov.br
- Escopo: Brasil, regioes, UF, municipio, estabelecimento CNES.
- Range: CNES em serie mensal a partir de 2005 em varias tabulacoes. A disponibilidade exata depende do modulo e da competencia. Algumas consultas tem defasagem operacional.

Dados a obter:

- `estabelecimentos_ativos`: total de estabelecimentos ativos.
- `hospitais_gerais_ativos` e `hospitais_especializados_ativos`: hospitais por tipo.
- `ubs_ativas`, `upa_pronto_atendimento`, `unidades_urgencia`: atencao primaria e urgencia.
- `estabelecimentos_sus_pct`: percentual com convenio/atendimento SUS.
- `leitos_existentes`: total de leitos existentes.
- `leitos_sus`: leitos habilitados/contratados para SUS.
- `leitos_uti_adulto`, `leitos_uti_pediatrica`, `leitos_uti_neonatal`: leitos criticos.
- `equipamentos_sus` e `equipamentos_total`: tomografo, ressonancia, mamografo, raio X, hemodialise e outros equipamentos relevantes.
- `medicos_vinculos`, `enfermeiros_vinculos`, `odontologos_vinculos`, `tecnicos_enfermagem_vinculos`: profissionais cadastrados.

Indicadores calculados:

- `hospitais_por_100k = hospitais_ativos / populacao * 100000`
- `leitos_por_1000 = leitos_existentes / populacao * 1000`
- `leitos_sus_por_1000 = leitos_sus / populacao * 1000`
- `leitos_uti_por_100k = leitos_uti_total / populacao * 100000`
- `medicos_por_1000 = medicos_vinculos / populacao * 1000`
- `enfermeiros_por_1000 = enfermeiros_vinculos / populacao * 1000`
- `equipamentos_alta_complexidade_por_100k = equipamentos / populacao * 100000`

Cuidados:

- CNES mede cadastro e capacidade registrada, nao taxa de ocupacao real.
- Profissionais no CNES podem ser vinculos/postos de trabalho, nao pessoas unicas; um profissional pode aparecer em mais de um estabelecimento.
- Município do estabelecimento não é necessariamente o município de residência da população atendida. Capitais e polos regionais podem parecer "superiores" por atenderem municípios vizinhos.
- Para serie historica, use a competencia de dezembro para retrato anual ou media mensal para reduzir ruido.

### 2. SIH/SUS - internacoes hospitalares no SUS

- Fonte: DATASUS TabNet, Morbidade Hospitalar do SUS.
- Escopo: Brasil, UF, municipio de residencia ou de internacao, CID-10, sexo, faixa etaria, ano/mes.
- Range pratico: desde a decada de 1990; para comparacao robusta, use 2008 em diante se precisar de melhor estabilidade de codificacao e municipios.

Dados a obter:

- `internacoes_sus`: quantidade de internacoes.
- `internacoes_por_cid10`: grupos de causa.
- `obitos_hospitalares_sus`: obitos em internacoes SUS.
- `taxa_mortalidade_hospitalar`: obitos / internacoes * 100.
- `media_permanencia`: dias de permanencia media.
- `valor_total_aih` e `valor_medio_internacao`: custo aprovado no SUS.

Indicadores:

- `internacoes_sus_por_10k = internacoes_sus / populacao * 10000`
- `mortalidade_hospitalar_pct = obitos_hospitalares_sus / internacoes_sus * 100`
- `internacoes_condicoes_sensiveis_aps_por_10k`: se classificar ICSAP, mede falhas potenciais de atencao primaria.

Cuidados:

- SIH/SUS cobre internacoes financiadas pelo SUS, nao toda a rede privada.
- Use municipio de residencia para avaliar saude da populacao; use municipio de internacao para avaliar pressao sobre a rede local.

### 3. SIM - mortalidade

- Fonte: Sistema de Informacoes sobre Mortalidade, DATASUS / OpenDataSUS.
- Escopo: Brasil, UF, municipio de residencia/ocorrencia, idade, sexo, causa CID-10.
- Range: o SIM foi desenvolvido em 1975; dados publicos historicos existem em diferentes recortes. Para analise municipal comparavel, prefira 1996 em diante e sinalize qualidade menor em anos antigos.

Dados a obter:

- `obitos_total`
- `obitos_por_causa_cid10`
- `obitos_causas_evitaveis`
- `obitos_infantis`
- `obitos_maternos`
- `obitos_doencas_cronicas_30_69`
- `obitos_causas_externas`

Indicadores:

- `mortalidade_geral_por_100k = obitos_total / populacao * 100000`
- `mortalidade_infantil_por_1000_nv = obitos_menor_1_ano / nascidos_vivos * 1000`
- `mortalidade_materna_por_100k_nv = obitos_maternos / nascidos_vivos * 100000`
- `mortalidade_dcNT_30_69_por_100k = obitos_dcNT_30_69 / populacao_30_69 * 100000`
- `mortalidade_causas_evitaveis_por_100k = obitos_evitaveis / populacao * 100000`

Cuidados:

- Para rankings entre municipios, use media movel de 3 anos em municipios pequenos.
- Diferencie local de residencia e local de ocorrencia.
- Para comparacao justa entre locais com estrutura etaria diferente, use taxa padronizada por idade quando possivel.

### 4. SINASC - nascidos vivos e saude materno-infantil

- Fonte: Sistema de Informacoes sobre Nascidos Vivos, DATASUS / OpenDataSUS.
- Escopo: Brasil, UF, municipio de residencia/ocorrencia, caracteristicas da mae, gestacao, parto e recem-nascido.
- Range: implantado nacionalmente na decada de 1990; para municipio, prefira 1994/1996 em diante conforme cobertura local.

Dados a obter:

- `nascidos_vivos`
- `baixo_peso_ao_nascer`
- `prematuridade`
- `parto_cesareo`
- `consultas_pre_natal_7_mais`
- `maes_adolescentes`

Indicadores:

- `baixo_peso_pct = baixo_peso / nascidos_vivos * 100`
- `prematuridade_pct = prematuros / nascidos_vivos * 100`
- `cesariana_pct = cesareas / nascidos_vivos * 100`
- `pre_natal_7mais_pct = nascidos_com_7mais_consultas / nascidos_vivos * 100`

### 5. SI-PNI / vacinacao

- Fonte: Programa Nacional de Imunizacoes via DATASUS/OpenDataSUS.
- Escopo: Brasil, UF, municipio, imunobiologico, ano.
- Dados: cobertura vacinal por vacina, doses aplicadas e populacao-alvo.
- Indicadores: BCG, polio, penta/DTP, triplice viral/sarampo, HPV, influenza quando aplicavel.

Cuidados:

- Cobertura pode passar de 100% por fluxo de atendimento, populacao-alvo estimada ou atraso de registro.
- Mudancas de sistema e atraso de digitacao podem gerar quebras de serie. Sempre guardar ano de atualizacao.

### 6. IBGE - denominadores e geografia

- API SIDRA: https://apisidra.ibge.gov.br
- Estimativas de populacao, tabela 6579: https://sidra.ibge.gov.br/tabela/6579
- Localidades: https://servicodados.ibge.gov.br/api/docs/localidades
- Escopo: Brasil, UF, municipio.

Usar para:

- denominador populacional de todos os indicadores per capita;
- codigo IBGE oficial de UF e municipio;
- populacao por idade quando calcular taxa especifica ou padronizada;
- malhas territoriais para mapa.

Cuidados:

- A tabela 6579 de estimativas municipais tem anos faltantes em algumas series; quando faltar ano, usar Censo 2010/2022 ou interpolacao documentada.
- Guarde `population_year` separado de `indicator_year`.

### 7. ANS - cobertura de planos privados

- Fonte: Agencia Nacional de Saude Suplementar, dados abertos.
- Link: https://dados.gov.br/dados/organizacoes/visualizar/agencia-nacional-de-saude-suplementar-ans
- Escopo: Brasil, UF, municipio, mes/ano, tipo de contratacao.

Indicadores:

- `beneficiarios_planos_saude`
- `cobertura_saude_suplementar_pct = beneficiarios / populacao * 100`

Use para separar dependencia provavel do SUS e presenca de saude suplementar. Nao interprete como acesso real garantido, pois plano nao significa oferta local suficiente.

### 8. SIOPS / FNS - financiamento publico

- Fontes: SIOPS e Fundo Nacional de Saude.
- Links: https://www.gov.br/saude/pt-br/acesso-a-informacao/siops e https://portalfns.saude.gov.br
- Escopo: Brasil, UF, municipio, ano.

Indicadores:

- `despesa_saude_per_capita`
- `despesa_saude_pct_receita`
- `transferencias_sus_per_capita`

Use como dimensao de capacidade financeira, nao como resultado direto.

## Variaveis finais recomendadas para o site

### Globo

- `life_expectancy`
- `hale`
- `uhc_service_coverage_index`
- `hospital_beds_per_10000`
- `physicians_per_10000`
- `nurses_midwives_per_10000`
- `health_expenditure_per_capita_ppp`
- `out_of_pocket_pct_current_health_expenditure`
- `under5_mortality_per_1000`
- `maternal_mortality_per_100k`
- `dalys_age_standardized_per_100k`
- `top_cause_of_death`

### Brasil / Estados / Municipios

- `leitos_existentes_por_1000`
- `leitos_sus_por_1000`
- `leitos_uti_por_100k`
- `hospitais_por_100k`
- `ubs_por_10k`
- `estabelecimentos_sus_pct`
- `medicos_por_1000`
- `enfermeiros_por_1000`
- `equipamentos_alta_complexidade_por_100k`
- `internacoes_sus_por_10k`
- `mortalidade_hospitalar_sus_pct`
- `mortalidade_infantil_por_1000_nv`
- `mortalidade_materna_por_100k_nv`
- `mortalidade_causas_evitaveis_por_100k`
- `mortalidade_dcNT_30_69_por_100k`
- `baixo_peso_pct`
- `prematuridade_pct`
- `pre_natal_7mais_pct`
- `cobertura_vacinal_triplice_viral_pct`
- `cobertura_saude_suplementar_pct`
- `despesa_saude_publica_per_capita`

## Como lidar com fontes divergentes

### Leitos hospitalares: WHO/Banco Mundial vs CNES Brasil

- WHO/Banco Mundial: melhor para comparar paises. Dados padronizados internacionalmente, mas podem estar defasados e usar populacao da ONU. Unidade comum: por 10.000 habitantes na OMS, por 1.000 no Banco Mundial.
- CNES: melhor para Brasil, UF e municipio. Mais detalhado, mensal e operacional, mas e cadastro administrativo e pode mudar por atualizacao/correcao de estabelecimentos.

Regra: no globo use WHO ou WDI; dentro do Brasil use CNES. Se mostrar Brasil no globo e Brasil detalhado, explique que os numeros podem divergir por ano, denominador, unidade e metodologia.

### Mortalidade: SIM vs IBGE Registro Civil

- SIM: melhor para epidemiologia e causas de morte, pois usa Declaracao de Obito e CID-10.
- IBGE Registro Civil: melhor para estatistica demografica legal de registros civis, mas nao substitui o SIM para causa de morte.

Regra: use SIM para indicadores de saude; use IBGE Registro Civil apenas como checagem ou contexto de cobertura/sub-registro.

### Profissionais: WHO/WDI vs CNES/Conselhos

- WHO/WDI: comparacao internacional padronizada, mas cada pais pode reportar medicos ativos ou registrados.
- CNES: vinculos em estabelecimentos de saude; pode contar a mesma pessoa mais de uma vez se ela trabalha em varios locais.
- Conselhos profissionais: medicos/enfermeiros registrados, mas registro nao garante atividade assistencial local.

Regra: use CNES como disponibilidade operacional no municipio e sinalize "vinculos cadastrados"; use WHO/WDI apenas para comparacao mundial.

## Regras de processamento

1. Sempre salvar `source_id`, `source_url`, `indicator_year`, `downloaded_at`, `territory_code`, `territory_name`, `scope` e `unit`.
2. Para Brasil, usar codigo IBGE de 2 digitos para UF e 7 digitos para municipio.
3. Para ranking municipal, esconder ou suavizar taxas com denominador pequeno. Preferir media de 3 anos em mortalidade e nascidos vivos.
4. Para mapa, separar indicador de capacidade instalada de indicador de resultado. Exemplo: leitos por habitante mede oferta, mortalidade infantil mede resultado.
5. Manter `sourceOptions` quando houver fonte alternativa para a mesma metrica.

## Arquivos locais implementados

- `data/health_global.json`: base inicial global por ISO3.
- `data/health_brazil.json`: base inicial para Brasil e UFs.
- `data/health_brazil_cities.json`: base municipal por código IBGE de 7 dígitos. Cobertura territorial completa para os 5.571 municípios. Cada município tem um campo `coverage`:
  - `municipal`: todos os 8 indicadores (leitos, UTI, SUS, medicos, enfermeiros, mort. infantil, mort. materna, vacinacao) sao reais e provem do DATASUS.
  - `partial`: parte dos indicadores e real (campo `realFields` lista quais); o resto continua proxy UF.
  - `uf_proxy`: nenhum indicador real, todos vem da UF.
  - O campo legado `municipal_initial` indica as 12 capitais que ja tinham dado municipal compilado na primeira versao.

## Extrator DATASUS (pysus)

A extracao automatica vive em `scripts/datasus/`:

- `population.py` — IBGE Sidra (tabela 4714, Censo 2022) por codigo IBGE de 7 digitos.
- `cnes_leitos.py` — CNES grupo LT (leitos por estabelecimento). Agrega `bedsPer1000`, `susBedsPer1000`, `icuBedsPer100k`. Junta pelo CODUFMUN (6 digitos).
- `cnes_profissionais.py` — CNES grupo PF. Filtra CBO `225*` ou `2231*` (medicos) e `2235*` (enfermeiros). Deduplica por `CNS_PROF` (CPFUNICO no export e anonimizado para `1` e inutil).
- `sim_sinasc.py` — SIM (DO) + SINASC (DN). Mortalidade com media movel de 3 anos. Exclui municipios com `<30` nascidos vivos no trienio. Tolera anos faltantes via concat + groupby (nao usar `sum(list_of_df)` — propaga NaN se algum frame estiver vazio).
- `pni.py` — PNI legado (CPNI). Media simples de COBERT entre todos os IMUNOs por municipio.

O orquestrador `scripts/build_health_brazil_cities.py` chama todos e mescla em `data/health_brazil_cities.json`. Aceita `--ufs GO SP` para subset de teste. Tudo cacheado pelo pysus em `~/pysus/` apos primeira execucao.

## TODO — o que ainda nao foi extraido

- **SI-PNI nominal (>=2020)**: o pysus expoe PNI somente ate 2019 (sistema legado). A cobertura vacinal recente esta no SI-PNI nominal (e-SUS), que precisa de scraper proprio do TabNet ou da API do Painel SI-PNI em `https://si-pni.saude.gov.br/`. Hoje usamos PNI legado 2019.
- **Indicador de vacinacao de referencia**: a media entre todos os IMUNOs e um proxy bruto. O ideal e escolher um imunobiologico padrao (penta em <1 ano, triplice viral) e fixar como metrica de cobertura.
- **CNES competence atualizada**: estamos puxando 2024-01. Quando rodar de novo, conferir o `list_files('CNES')` para a competencia mais recente disponivel.
- **SIM/SINASC 2023+**: a janela atual vai ate 2022 porque foi quando rodamos. Alguns arquivos pontuais estao indisponiveis (ex.: SP SIM 2021). O extrator tolera ausencia, mas o ideal e re-rodar quando o DATASUS publicar.
- **Classificacao de UTI mais granular**: hoje `icuBedsPer100k` = soma de `TP_LEITO=3` (Complementar), que inclui UTI + UCI. Para distinguir UTI estrita, filtrar por `CODLEITO` no intervalo 74-83 (UTIs) e nao 84-90 (UCIs).
- **App UI**: o card de município ainda diz "Dado municipal" para qualquer município com `proxy=false`. Quando `coverage="partial"`, deve explicitar "Misto: alguns campos são proxy UF" e listar `realFields`.
- **Profissionais ANS/ANS suplementar**: ainda nao temos `privateCoverage` real por municipio. Continua como proxy UF.

Para regenerar tudo: `python -m scripts.build_health_brazil_cities`. Para atualizar so a mortalidade (caso bug do `sum()` reapareca): `python -m scripts.patch_mortality`.

## Sugestao de leitura visual

Use grupos de criterios na aba:

- **Resultado de saude:** expectativa de vida, HALE, mortalidade infantil, mortalidade materna, mortalidade por causas evitaveis, DALYs.
- **Capacidade hospitalar:** hospitais por 100 mil, leitos por 1.000, leitos SUS por 1.000, UTI por 100 mil.
- **Acesso e cobertura:** UHC global, cobertura APS/ESF no Brasil, cobertura vacinal, saude suplementar.
- **Forca de trabalho:** medicos, enfermeiros, odontologos por habitante.
- **Complexidade e infraestrutura:** equipamentos de diagnostico e alta complexidade por habitante.
- **Uso do sistema:** internacoes SUS, mortalidade hospitalar, permanencia media.
- **Financiamento:** gasto em saude per capita, gasto direto das familias, despesa publica municipal.

## Texto curto para o painel do site

A aba Saude/Hospitais combina fontes internacionais e brasileiras para mostrar tanto a comparacao entre paises quanto o detalhe territorial do Brasil. No globo, os indicadores usam principalmente a OMS/WHO Global Health Observatory e, quando for tecnicamente mais conveniente, a API do Banco Mundial/WDI como redistribuicao ou fonte alternativa. No Brasil, a capacidade instalada vem do CNES/DATASUS, os resultados de saude de SIM/SINASC/SIH/SI-PNI, os denominadores populacionais do IBGE, a saude suplementar da ANS e o financiamento do SIOPS/FNS. Indicadores parecidos podem divergir entre fontes porque usam anos, denominadores, unidades e criterios diferentes; por isso cada metrica deve exibir fonte, ano e metodologia.
