# Atlas Brasil

Site estático para análise territorial do Brasil em um globo interativo, começando por população de estados e municípios.

## Rodar localmente

Abra `index.html` diretamente no navegador ou sirva a pasta com qualquer servidor estático.

```text
http://localhost:8000/
```

O diretório `tools/` é reservado para utilitários locais e não faz parte do repositório versionado.

## Dados

- População: IBGE/SIDRA, tabela 4714, Censo Demográfico 2022.
- PIB territorial: IBGE/SIDRA, tabela 5938, Produto Interno Bruto a preços correntes.
- Malhas geográficas: API de Malhas Geográficas do IBGE.
- Localidades: API de Localidades do IBGE.
- Mapa base: MapLibre GL com OpenFreeMap e Esri World Imagery.

## Segurança e privacidade

- O projeto não usa chaves de API, autenticação, cookies ou coleta de dados do usuário.
- Dados exibidos vêm de APIs públicas.
- Dependências de CDN estão fixadas por versão quando possível.
