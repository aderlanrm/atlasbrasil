# Dados e atualização do Atlas Brasil

## Contrato da publicação estática

O conteúdo servido ao navegador fica exclusivamente em
`data/parquet/site/`. Todos os arquivos são Parquet ou GeoParquet comprimidos
com Zstandard nível 19. O carregador JavaScript lê esse formato diretamente,
sem API intermediária ou banco de dados. Essa garantia cobre indicadores e
polígonos; os três mapas-base visuais são tiles online e não fazem parte do ETL.

```text
data/parquet/site/
├── atlas/                     indicadores nacionais e territoriais
├── municipalities/UF.parquet malha municipal por estado
├── sectors/UF/IBGE.parquet   setores de um município
├── states.parquet            malha das UFs
└── manifest.parquet          inventário de arquivos, linhas e tamanhos
```

Os JSONs, CSVs, planilhas, PDFs e ZIPs usados por extratores legados ou como
entrada transitória não entram no artefato publicado. O script
`.github/scripts/minify_static.py` aplica essa regra ao montar `dist/`.

## Pipeline recomendado

1. Instale as versões fixadas em `requirements-etl.txt` com Python 3.14.x.
2. Atualize indicadores globais e nacionais diretamente das fontes oficiais:

   ```powershell
   python scripts/generate_atlas_indicators.py --datasets all
   python scripts/fetch_world_data.py
   python scripts/generate_security_brazil_cities.py
   python scripts/build_health_brazil_cities.py
   python scripts/build_atlas_master.py
   ```

   A etapa municipal de saúde consulta arquivos extensos do DATASUS e costuma
   ser a parte mais demorada. Para uma validação curta do extrator, use
   `--ufs PE`; não publique esse resultado parcial como atualização nacional.
   A malha mundial vem do projeto `geo-countries`; população e PIB vêm da API
   pública do Banco Mundial, e a área é calculada geodesicamente a partir dos
   polígonos. O ETL não depende de chave do RestCountries.

3. Atualize setores e agregações. Sem UFs explícitas, todas são processadas:

   ```powershell
   python scripts/generate_census_tracts.py --profile map
   ```

   O perfil `map` traz os temas prioritários descritos no catálogo censitário:
   população e domicílios, idade, sexo, alfabetização, cor ou raça, renda,
   saneamento e características territoriais. `--profile all` preserva o
   universo completo para pesquisa e ETL, mas não deve ser publicado sem uma
   revisão do tamanho e da utilidade dos indicadores.

4. Quando houver nova edição do IPS, atualize e valide a fonte oficial. O JSON
   produzido por esse gerador é apenas uma entrada transitória e não entra no
   site:

   ```powershell
   python scripts/generate_ips_brazil.py --download
   ```

   A geração de histórias por IA é opcional e não faz parte da atualização
   mensal dos indicadores oficiais. Se não for executada, o publicador conserva
   as histórias já revisadas no repositório.

5. Converta os conjuntos próprios para a área intermediária do ETL e prepare
   do zero a publicação particionada:

   ```powershell
   python scripts/build_static_extras.py
   python scripts/build_static_site_data.py --clean-output --workers 8
   ```

   Execute `build_static_extras.py` antes do publicador. Suas saídas ficam em
   `data/parquet/` e são copiadas para `site/atlas` durante a publicação; assim
   `--clean-output` não apaga IPS, histórias ou catálogos.

6. Execute os testes, confira `data/parquet/site/manifest.parquet`, sirva o site
   localmente e valide pelo menos uma UF, um município e seus setores. O roteiro
   verificável está em [TESTE_MANUAL_E_COMMIT.md](TESTE_MANUAL_E_COMMIT.md).

O publicador aceita `--source CAMINHO` para receber os Parquets de outro
diretório de ETL. `--clean-output` remove somente uma saída validada cujo nome
é `site`; use-o quando for necessária uma reconstrução integral. Antes da
remoção, o script exige as 19 tabelas do site e as partições das 27 UFs, para
não produzir silenciosamente um pacote parcial.

## Proveniência e interpretação

Cada indicador deve registrar fonte, ano, unidade, nível territorial e regra de
agregação no catálogo. Totais podem ser distribuídos com conservação exata;
taxas e índices herdados de município ou UF devem permanecer identificados como
`proxy` e nunca ser divididos como totais. Valores observados, estimados,
imputados ou simulados não podem ser apresentados como equivalentes.

As páginas externas indicadas na interface são links de auditoria. Elas não são
fontes dos indicadores em tempo de execução: esses downloads acontecem apenas
nos scripts de ETL. Durante a navegação, somente os tiles Esri World Imagery,
OpenStreetMap e CARTO Dark Matter são consultados, conforme a escolha de fundo.
As atribuições permanecem visíveis no mapa. Não faça download em massa,
pré-carregamento ou cache offline dos tiles; consulte as políticas dos
provedores antes de qualquer automação desse tráfego.

## Sugestão de atualização mensal no GitHub Actions

Não foi criado nem alterado um workflow de atualização automática. Se o
proprietário optar por automatizar, recomenda-se um workflow mensal separado,
com acionamento manual adicional, que:

1. faça checkout e configure a versão Python 3.14 disponível;
2. instale `requirements-etl.txt`;
3. restaure um cache opcional dos downloads oficiais;
4. execute os comandos da seção “Pipeline recomendado”;
5. rode testes e valide o manifesto e o limite de tamanho do Pages;
6. abra uma Pull Request com os Parquets atualizados, em vez de publicar
   diretamente na branch principal.

Exemplo de gatilho a ser avaliado pelo proprietário:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "20 6 1 * *" # dia 1 de cada mês, 06:20 UTC
```

Essa frequência é suficiente para bases anuais ou mensais comuns no Atlas. Um
job deve falhar, e não publicar silenciosamente, se uma fonte mudar de esquema,
se a cobertura territorial cair ou se um arquivo ultrapassar o limite aceito
pelo GitHub.
