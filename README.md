# Atlas Brasil — Inteligência Mil Grau

Atlas territorial totalmente estático para explorar indicadores do Brasil,
estados, municípios e setores censitários. O site é compatível com GitHub
Pages: não possui servidor, banco de dados, autenticação, atendimento embutido nem chamadas
automáticas a APIs de indicadores durante a navegação. Indicadores e polígonos
são locais; somente o fundo cartográfico escolhido pelo usuário usa tiles online.

## Arquitetura

- O navegador lê apenas arquivos locais em `data/parquet/site/`.
- Tabelas e geometrias usam Parquet/GeoParquet com Zstandard nível 19.
- Os 468.097 setores do Censo 2022 estão particionados em 5.570 arquivos
  municipais, evitando baixar a malha do país inteiro. O cadastro atual contém
  ainda o novo município de Boa Esperança do Norte (MT), criado após o Censo.
- MapLibre, Lucide e o leitor Parquet estão incorporados em `vendor/` com
  versões fixas; consulte `THIRD_PARTY_NOTICES.md`.
- Os scripts Python consultam fontes oficiais somente no momento do ETL. A
  publicação contém os resultados, e o navegador não repete essas consultas.
- Os fundos são, nesta ordem, Terra (imagem Esri, padrão), Mapa
  (OpenStreetMap) e Contraste (CARTO Dark Matter). Eles precisam de internet,
  mas não alteram a arquitetura estática nem enviam indicadores aos provedores.

## Rodar localmente

Arquivos Parquet precisam ser servidos por HTTP; abrir `index.html` diretamente
como `file://` não é suportado.

```powershell
python -m http.server 8000
```

Depois acesse `http://localhost:8000/`. Não é necessário instalar dependências
JavaScript nem executar um build para desenvolver a interface.

## Atualizar os dados

Use Python 3.14.x e um ambiente virtual separado:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-etl.txt
.\.venv\Scripts\python scripts\generate_atlas_indicators.py --datasets all
.\.venv\Scripts\python scripts\fetch_world_data.py
.\.venv\Scripts\python scripts\generate_security_brazil_cities.py
.\.venv\Scripts\python scripts\build_health_brazil_cities.py
.\.venv\Scripts\python scripts\build_atlas_master.py
.\.venv\Scripts\python scripts\generate_census_tracts.py --profile map
.\.venv\Scripts\python scripts\generate_ips_brazil.py --download
.\.venv\Scripts\python scripts\build_static_extras.py
.\.venv\Scripts\python scripts\build_static_site_data.py --clean-output --workers 8
```

O perfil `map` mantém os temas mais relevantes e comuns para pesquisa. O ETL
também aceita `--profile all` para preservar todos os códigos oficiais fora da
publicação, mas o site continua publicando apenas o catálogo selecionado.
Detalhes de ordem, fontes, validações e sugestão de atualização mensal estão em
[`docs/DADOS.md`](docs/DADOS.md).

## Testes

```powershell
npm test
python -m compileall -q scripts
node --check app.js
node --check parquet_loader.js
node --check static_data_adapter.js
```

O roteiro completo de ETL, testes manuais, conferência do pacote, commit, push
e abertura da Pull Request está em
[`docs/TESTE_MANUAL_E_COMMIT.md`](docs/TESTE_MANUAL_E_COMMIT.md).

## Publicação

O workflow de Pages já existente prepara `dist/` e exclui entradas brutas e
intermediárias. Somente `data/parquet/site/` entra no site. A atualização dos
dados não foi automatizada: cabe ao proprietário decidir se deseja adotar a
rotina mensal sugerida na documentação.

## Segurança e privacidade

- não há chaves, cookies analíticos ou coleta de dados pessoais;
- a política CSP limita scripts, estilos e fontes ao próprio site; conexões de
  imagem são liberadas apenas para Esri, OpenStreetMap e CARTO, além de
  `data:`/`blob:` necessários ao mapa;
- links de auditoria podem levar o usuário às páginas das fontes, mas nenhuma
  delas é consultada automaticamente.
