# ETL, teste manual e envio para aprovação

Este roteiro parte da raiz do repositório, em Windows PowerShell, na branch de
contribuição. Não abra `index.html` por `file://`: Parquet precisa ser servido
por HTTP.

## 1. Confirmar branch e ambiente

```powershell
Set-Location D:\PYdeAZ\AtlasBrasil
git branch --show-current
git status --short
py -3.14 --version
```

A branch desta migração deve ser `codex/migracao-parquet`. Preserve alterações
locais existentes; não use `git reset --hard` nem troque arquivos à força.

Crie o ambiente e instale as versões fixadas:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements-etl.txt
```

Se o ambiente já existia, execute novamente o último comando. Isso instala
dependências acrescentadas depois, como `httpx`, usado no download do IPS.

## 2. Executar o ETL completo

Os comandos abaixo acessam a internet somente no Python, durante a atualização.
O navegador do site nunca consulta essas fontes.

```powershell
.\.venv\Scripts\python scripts\generate_atlas_indicators.py --datasets all
.\.venv\Scripts\python scripts\fetch_world_data.py
.\.venv\Scripts\python scripts\generate_security_brazil_cities.py
.\.venv\Scripts\python scripts\build_health_brazil_cities.py
.\.venv\Scripts\python scripts\build_atlas_master.py
.\.venv\Scripts\python scripts\generate_census_tracts.py --profile map
```

O ETL setorial baixa e processa todas as UFs quando nenhuma sigla é informada.
Ele gera as agregações hierárquicas automaticamente. Para um teste rápido e
não publicável, é possível usar, por exemplo:

```powershell
.\.venv\Scripts\python scripts\generate_census_tracts.py PE --profile map
```

Quando existir nova edição do IPS, atualize-a antes de montar a publicação:

```powershell
.\.venv\Scripts\python scripts\generate_ips_brazil.py --download
```

As histórias dos municípios são uma frente editorial opcional. Não execute
`generate_city_stories.py` numa atualização rotineira sem a configuração e a
revisão humana exigidas por esse gerador.

## 3. Gerar os Parquets publicados

```powershell
.\.venv\Scripts\python scripts\build_static_extras.py
.\.venv\Scripts\python scripts\build_static_site_data.py --clean-output --workers 8
```

O primeiro comando prepara IPS, histórias e catálogos em `data/parquet/`. O
segundo limpa somente `data/parquet/site/`, recompata tudo com Zstandard nível
19 e cria as partições municipais. Ao final, confira se o resumo informa:

- 27 arquivos de malhas municipais estaduais;
- 5.570 arquivos municipais de setores;
- 468.097 setores censitários;
- 27 geometrias de UF;
- os 19 Parquets do grupo `atlas`.

O publicador agora valida todas as 19 tabelas e as 27 partições estaduais
**antes** de limpar `data/parquet/site/`. Uma origem ausente cancela a operação
com erro; `[SKIP]` não é um resultado aceitável para uma publicação completa.

### Recuperação dos erros de download mundial e IPS

Se uma execução anterior exibiu `AttributeError: 'str' object has no attribute
'get'` em `fetch_world_data.py`, ela recebeu a mensagem de desativação da API
RestCountries v3.1. O extrator atualizado não usa mais esse serviço: população
e PIB vêm da API pública do Banco Mundial, e a área é calculada a partir da
malha. Execute novamente:

```powershell
.\.venv\Scripts\python scripts\fetch_world_data.py
```

Se o IPS informou `httpx não instalado`, sincronize o ambiente e repita o
download:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-etl.txt
.\.venv\Scripts\python scripts\generate_ips_brazil.py --download
```

Somente depois de ambos terminarem com `[OK]` ou mensagem de arquivo gravado,
repita os dois comandos da seção 3. No resumo, `atlas` deve ter 19 arquivos.

Confira também quantidade e tamanho:

```powershell
$site = Get-ChildItem data\parquet\site -Recurse -File | Measure-Object Length -Sum
"Arquivos: $($site.Count)"
"Bytes: $($site.Sum)"
```

O pacote atual fica perto de 895 MB. Interrompa a publicação se o diretório
`dist/` alcançar 1 GB ou se algum arquivo individual chegar a 100 MB. Não use
Git LFS para os arquivos publicados: o GitHub Pages receberia ponteiros em vez
dos Parquets consumidos pelo navegador.

## 4. Testes automatizados

```powershell
npm test
.\.venv\Scripts\python -m compileall -q scripts
node --check app.js
node --check parquet_loader.js
node --check static_data_adapter.js
git diff --check
```

Todos os comandos devem terminar com código zero. Atualmente a suíte contém 33
testes Node.

## 5. Testar o código-fonte no navegador

Em um PowerShell separado, na raiz do projeto:

```powershell
.\.venv\Scripts\python -m http.server 8000 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8000/` e valide:

1. o painel nacional mostra população, PIB e 27 UFs;
2. PIB, IDH, IPS, Política, Educação, Segurança, Saúde e SSE abrem sem erro;
3. a busca encontra um município conhecido, como Recife;
4. ao abrir Recife, Pernambuco e os indicadores municipais são exibidos;
5. o botão **Setores** carrega a malha, mostra o seletor setorial e abre os
   detalhes no mesmo padrão visual de país, UF e município;
6. teste **Bairro**, **População residente**, renda, saneamento e um indicador
   marcado como proxy; confirme que **Bairro** usa uma lista de categorias com
   nomes e cores, enquanto os indicadores numéricos usam a barra de escala;
7. teste Globo/Plano e os fundos online na ordem Terra (padrão), Mapa e
   Contraste; confirme que a atribuição do provedor aparece;
8. teste separadamente **Detalhes no mouse** e **Exibir bolhas**, confirmando
   que a preferência das bolhas é restaurada após atualizar a página;
9. teste a interface em largura de celular e desktop;
10. atualize a página e confirme que as preferências restauradas não quebram a
   navegação.

Nas ferramentas do navegador, abra **Network**, marque **Disable cache** e
recarregue. Indicadores e geometrias devem apontar para `127.0.0.1:8000`.
Requisições externas automáticas devem ficar restritas aos tiles de
`server.arcgisonline.com`, `tile.openstreetmap.org` ou
`*.basemaps.cartocdn.com`; links de auditoria só abrem quando clicados.
Confira também se o Console não contém erros.

## 6. Testar exatamente o pacote do GitHub Pages

Pare o servidor anterior antes de reconstruir `dist/` no Windows. Depois:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-build.txt
.\.venv\Scripts\python .github\scripts\minify_static.py
$dist = Get-ChildItem dist -Recurse -File | Measure-Object Length -Sum
"Arquivos: $($dist.Count)"
"Bytes: $($dist.Sum)"
```

Em outro PowerShell:

```powershell
Set-Location D:\PYdeAZ\AtlasBrasil\dist
..\.venv\Scripts\python -m http.server 8001 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8001/` e repita ao menos o carregamento nacional, uma
análise e o fluxo UF → município → setores. `dist/` é temporário e está ignorado
pelo Git; não o inclua no commit.

## 7. Revisar e criar o commit

Depois de encerrar os servidores e concluir os testes manuais:

```powershell
Set-Location D:\PYdeAZ\AtlasBrasil
git branch --show-current
git status --short
git diff --check
git check-ignore dist .builddeps data\parquet\city_indicators_master.parquet
```

Revise especialmente documentação, scripts, interface e o volume de
`data/parquet/site/`. Depois adicione as mudanças:

```powershell
git add -A
git status --short
git diff --cached --check
git diff --cached --stat
```

Confirme que `dist/`, `.venv/`, `.builddeps/` e Parquets intermediários não
foram preparados. Somente `data/parquet/site/` deve conter os Parquets
publicáveis. Se tudo estiver correto:

```powershell
git commit -m "feat: migra o Atlas estático para Parquet"
git push origin codex/migracao-parquet
```

Por fim, abra uma Pull Request de `aderlanrm:codex/migracao-parquet` para
`inteligenciamilgrau/atlasbrasil:main`. No texto da PR, informe:

- que o site continua totalmente estático;
- que o runtime usa somente Parquet/GeoParquet Zstandard local;
- quantidade de setores, municípios e tamanho do pacote;
- testes automatizados e manuais executados;
- que nenhuma automação mensal de ETL foi adicionada;
- limitações conhecidas, incluindo proxies e margem restante até 1 GB.
