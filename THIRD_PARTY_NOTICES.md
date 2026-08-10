# Dependências JavaScript incorporadas

O site não carrega bibliotecas de CDN. As cópias abaixo ficam em `vendor/`,
com versão fixa, para que a execução no navegador seja integralmente estática.

| Biblioteca | Versão | Licença | Arquivo local |
|---|---:|---|---|
| MapLibre GL JS | 5.24.0 | BSD-3-Clause | `vendor/maplibre/` |
| Lucide | 0.559.0 | ISC | `vendor/lucide/lucide.min.js` |
| hyparquet | 1.28.0 | MIT | `vendor/hyparquet/hyparquet.js` |
| fzstd | 0.1.1 | MIT | `vendor/hyparquet/fzstd.js` |

Os cabeçalhos de licença dos distribuíveis foram preservados. Os textos
integrais e os repositórios de origem são os indicados nos cabeçalhos de cada
arquivo e nos respectivos pacotes publicados no npm.

## Serviços de mapas-base online

Indicadores e polígonos continuam locais. Os fundos visuais usam os serviços
abaixo em navegação interativa e exibem a atribuição fornecida por cada fonte:

| Opção | Serviço | Endereço/política |
|---|---|---|
| Terra | Esri World Imagery | `server.arcgisonline.com` |
| Mapa | OpenStreetMap Standard | https://operations.osmfoundation.org/policies/tiles/ |
| Contraste | CARTO Dark Matter | https://github.com/CartoDB/basemap-styles |

Esses serviços não são empacotados, espelhados nem pré-carregados pelo Atlas.
