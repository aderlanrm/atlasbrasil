const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mocks do browser mínimos para evitar que o app.js quebre ao carregar em Node
globalThis.window = {
  self: {},
  top: {},
  caches: {
    open: async () => ({
      match: async () => null,
      put: async () => {},
      delete: async () => true
    })
  },
  location: { href: "" }
};
globalThis.window.self = globalThis.window;
globalThis.window.top = globalThis.window;

globalThis.document = {
  querySelectorAll: () => ({
    forEach: () => {}
  }),
  querySelector: () => null,
  addEventListener: () => {},
  getElementById: () => null
};

globalThis.navigator = {
  userAgent: "Node"
};

globalThis.maplibregl = {
  Map: class {
    on() {}
    addSource() {}
    getLayer() {}
    getSource() {}
    getStyle() { return { layers: [] }; }
  }
};

// Carrega o app.js
require('../app.js');

const utils = globalThis.TestUtils;

test('escapeHtml() - Escapa tags e caracteres especiais HTML para proteção XSS', () => {
  assert.equal(utils.escapeHtml('<script>alert("XSS")</script>'), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  assert.equal(utils.escapeHtml("John's Cafe & Co."), 'John&#039;s Cafe &amp; Co.');
  assert.equal(utils.escapeHtml(''), '');
  assert.equal(utils.escapeHtml(null), '');
  assert.equal(utils.escapeHtml(undefined), '');
});

test('normalizeCode() - Remove caracteres não numéricos de códigos territoriais (IBGE)', () => {
  assert.equal(utils.normalizeCode('35-5030.8'), '3550308');
  assert.equal(utils.normalizeCode('35 503 08'), '3550308');
  assert.equal(utils.normalizeCode('BR'), '');
  assert.equal(utils.normalizeCode(null), '');
  assert.equal(utils.normalizeCode(undefined), '');
});

test('parseNumber() - Faz parse correto de números brutos e formatos brasileiros', () => {
  assert.equal(utils.parseNumber(123.45), 123.45);
  assert.equal(utils.parseNumber('1.234.567,89'), 1234567.89);
  assert.equal(utils.parseNumber('45,2'), 45.2);
  assert.equal(utils.parseNumber('-'), 0);
  assert.equal(utils.parseNumber(''), 0);
  assert.equal(utils.parseNumber(null), 0);
});

test('clampNumber() - Restringe valores ao intervalo min/max com fallback para NaN', () => {
  assert.equal(utils.clampNumber(50, 10, 100, 20), 50);
  assert.equal(utils.clampNumber(5, 10, 100, 20), 10);
  assert.equal(utils.clampNumber(150, 10, 100, 20), 100);
  assert.equal(utils.clampNumber(NaN, 10, 100, 20), 20);
});

test('normalizeText() - Remove acentos, padroniza caixa e trim de espaços', () => {
  assert.equal(utils.normalizeText(' São Paulo - SP '), 'sao paulo - sp');
  assert.equal(utils.normalizeText('ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ'), 'aaaaaaceeeeiiiinooooouuuuyy');
  assert.equal(utils.normalizeText(''), '');
  assert.equal(utils.normalizeText(null), '');
});

test('sseScores() - Calcula os índices compostos de saúde, educação, segurança e o SSE total', () => {
  // Caso de teste equilibrado
  const row = {
    bedsPer1000: 2, // 2/4 * 100 = 50
    doctorsPer1000: 2, // 2/4 * 100 = 50
    vaccinationCoverage: 80, // 80
    infantMortality: 4, // 100 - 4*5 = 80
    // Saude: (50 + 50 + 80 + 80) / 4 = 65
    mviRate: 10, // 100 - 10*2 = 80
    // Seguranca: 80
    enemScore: 550 // (550 - 450) / 200 * 100 = 50
    // Educacao: 50
  };
  
  const scores = utils.sseScores(row);
  assert.equal(scores.saudeScore, 65);
  assert.equal(scores.segurancaScore, 80);
  assert.equal(scores.educacaoScore, 50);
  assert.equal(scores.sseTotal, 65); // Média de 65, 80, 50 = 195/3 = 65
});

// Testes de regressão do PIB de São Paulo em 2023 (unificados do arquivo original)
const fs = require('node:fs');

const SAO_PAULO_CITY_PIB_2023 = {
    year: '2023',
    table: '5938',
    variable: '37',
    unit: 'Mil Reais',
    cityId: '3550308',
    cityName: 'São Paulo (SP)',
    sourceValueMilReais: 1066825104.98,
    sidraRoundedValueMilReais: 1066825105
};

function makeSaoPauloCityPibResponse(value = '1066825105') {
    return [
        {
            id: '37',
            variavel: 'Produto Interno Bruto a preços correntes',
            unidade: 'Mil Reais',
            resultados: [
                {
                    classificacoes: [],
                    series: [
                        {
                            localidade: {
                                id: '3550308',
                                nivel: {
                                    id: 'N6',
                                    nome: 'Município'
                                },
                                nome: 'São Paulo (SP)'
                            },
                            serie: {
                                2023: value
                            }
                        }
                    ]
                }
            ]
        }
    ];
}

function extractSaoPauloCityPib2023(response) {
    const variableBlock = response[0];
    const record = variableBlock.resultados[0].series[0];
    const valueMilReais = Number(record.serie[SAO_PAULO_CITY_PIB_2023.year]);

    return {
        variable: String(variableBlock.id),
        unit: variableBlock.unidade,
        cityId: String(record.localidade.id),
        cityName: record.localidade.nome,
        level: record.localidade.nivel.id,
        valueMilReais
    };
}

function formatCurrencyShort(value) {
    const number = Number(value || 0);
    if (!number) return '-';
    const abs = Math.abs(number);
    if (abs >= 1000000000000) {
        return `R$ ${(number / 1000000000000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tri`;
    }
    if (abs >= 1000000000) {
        return `R$ ${(number / 1000000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
    }
    return number.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0
    });
}

test('PIB do município de São Paulo em 2023 bate com o SIDRA', () => {
    const parsed = extractSaoPauloCityPib2023(makeSaoPauloCityPibResponse());

    assert.equal(parsed.variable, SAO_PAULO_CITY_PIB_2023.variable);
    assert.equal(parsed.unit, SAO_PAULO_CITY_PIB_2023.unit);
    assert.equal(parsed.level, 'N6');
    assert.equal(parsed.cityId, SAO_PAULO_CITY_PIB_2023.cityId);
    assert.equal(parsed.cityName, SAO_PAULO_CITY_PIB_2023.cityName);
    assert.equal(Math.round(SAO_PAULO_CITY_PIB_2023.sourceValueMilReais), 1066825105);
    assert.equal(parsed.valueMilReais, SAO_PAULO_CITY_PIB_2023.sidraRoundedValueMilReais);
});

test('PIB de São Paulo em 2023 é exibido sem arredondar demais trilhões', () => {
    const valueReais = SAO_PAULO_CITY_PIB_2023.sidraRoundedValueMilReais * 1000;

    assert.equal(formatCurrencyShort(valueReais), 'R$ 1,07 tri');
});

test('app busca PIB municipal oficial de 2023 sem cair para 2021', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    assert.match(appSource, /LATEST_OFFICIAL_GDP_YEAR\s*=\s*"2023"/);
    assert.match(appSource, /minimumFractionDigits:\s*2,\s*maximumFractionDigits:\s*2/);
    assert.doesNotMatch(appSource, /year\s*>\s*2021/);
    assert.doesNotMatch(appSource, /last\/1"\s*\?\s*"2021"/);
});

// IPS - Índice de Progresso Social (data/ips_brazil.json)

function loadIpsData() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ips_brazil.json'), 'utf8'));
}

test('IPS - data/ips_brazil.json tem o contrato que o app consome', () => {
    const data = loadIpsData();

    assert.equal(typeof data.edition, 'number');
    assert.deepEqual(data.editions, ['2024', '2025', '2026']);
    assert.equal(data.latestYear, 2026);
    assert.ok(data.comparabilityWarning.length > 0, 'o aviso de comparabilidade da fonte tem que estar no JSON');
    assert.deepEqual(Object.keys(data.dimensionLabels).sort(), ['basicNeeds', 'opportunity', 'wellbeing']);

    for (const year of data.editions) {
        const brazilYear = data.brazil.byYear[year];
        assert.ok(brazilYear.ips > 0 && brazilYear.ips <= 100, `IPS do Brasil fora da escala em ${year}`);
        assert.deepEqual(Object.keys(brazilYear.dimensions).sort(), ['basicNeeds', 'opportunity', 'wellbeing']);
    }

    const states = Object.entries(data.states);
    assert.equal(states.length, 27, 'devem ser 26 estados + DF');
    for (const [code, row] of states) {
        assert.match(code, /^\d{2}$/, `código IBGE inválido: ${code}`);
        for (const year of data.editions) {
            const entry = row.byYear[year];
            assert.ok(entry, `${row.uf} sem dado em ${year}`);
            assert.ok(entry.ips > 0 && entry.ips <= 100, `IPS fora da escala em ${row.uf}/${year}`);
            assert.ok(entry.rank >= 1 && entry.rank <= 27, `ranking fora do intervalo em ${row.uf}/${year}`);
        }
    }

    // Em cada edição o ranking vai de 1 a 27 sem repetir.
    for (const year of data.editions) {
        const ranks = states.map(([, row]) => row.byYear[year].rank).sort((a, b) => a - b);
        assert.deepEqual(ranks, Array.from({ length: 27 }, (_, i) => i + 1), `ranking inconsistente em ${year}`);
    }
});

test('IPS - valores conferem com o relatório oficial do IPS Brasil 2026', () => {
    const data = loadIpsData();

    // Âncoras do Quadro 11 e da seção Resultados do relatório geral.
    assert.equal(data.brazil.byYear['2026'].ips, 63.40);
    assert.equal(data.brazil.byYear['2026'].dimensions.basicNeeds, 74.58);
    assert.equal(data.brazil.byYear['2026'].dimensions.wellbeing, 68.81);
    assert.equal(data.brazil.byYear['2026'].dimensions.opportunity, 46.82);

    assert.equal(data.states['53'].byYear['2026'].ips, 70.73); // Distrito Federal, 1º
    assert.equal(data.states['53'].byYear['2026'].rank, 1);
    assert.equal(data.states['35'].byYear['2026'].ips, 67.96); // São Paulo, 2º
    assert.equal(data.states['15'].byYear['2026'].ips, 55.80); // Pará, 27º
    assert.equal(data.states['15'].byYear['2026'].rank, 27);

    // O ranking tem que ser coerente com a nota: 1º = maior IPS.
    const rows = Object.values(data.states).map((row) => ({ uf: row.uf, ...row.byYear['2026'] }))
        .sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i - 1].ips >= rows[i].ips, `ranking inconsistente entre ${rows[i - 1].uf} e ${rows[i].uf}`);
    }
});

test('IPS - série recalculada é separada dos valores por edição (comparabilidade)', () => {
    const data = loadIpsData();

    // A série recalculada do relatório usa os parâmetros da edição vigente.
    assert.equal(data.brazil.recalculatedSeries['2024'].ips, 62.85);
    assert.equal(data.brazil.recalculatedSeries['2025'].ips, 63.05);
    assert.equal(data.brazil.recalculatedSeries['2026'].ips, 63.40);

    // Os valores POR EDIÇÃO são os publicados na época e diferem da série
    // recalculada nos anos anteriores. Misturar os dois seria erro de leitura.
    assert.notEqual(data.brazil.byYear['2024'].ips, data.brazil.recalculatedSeries['2024'].ips);
    assert.notEqual(data.brazil.byYear['2025'].ips, data.brazil.recalculatedSeries['2025'].ips);
    // Na edição vigente os dois coincidem, por construção.
    assert.equal(data.brazil.byYear['2026'].ips, data.brazil.recalculatedSeries['2026'].ips);
});

test('IPS - mergeIpsBrazil hidrata os estados no ano ativo e formatIps usa vírgula', () => {
    const data = loadIpsData();

    utils.seedStateForTests({ id: '53', sigla: 'DF', nome: 'Distrito Federal' });
    utils.seedStateForTests({ id: '15', sigla: 'PA', nome: 'Pará' });
    utils.mergeIpsBrazil(data);

    // Sem escolha explícita, cai na edição vigente.
    assert.equal(utils.ipsEdition(), '2026');
    assert.equal(utils.getStateById('53').ips, 70.73);
    assert.equal(utils.getStateById('53').ipsRank, 1);
    assert.equal(utils.getStateById('15').ips, 55.80);

    // Trocar o ano re-hidrata os estados com os valores daquela edição.
    utils.setActiveIpsYear('2024');
    assert.equal(utils.ipsEdition(), '2024');
    assert.equal(utils.getStateById('53').ips, data.states['53'].byYear['2024'].ips);
    assert.notEqual(utils.getStateById('53').ips, 70.73);

    utils.setActiveIpsYear('2026');
    assert.equal(utils.getStateById('53').ips, 70.73);

    assert.equal(utils.formatIps(70.73), '70,73');
    assert.equal(utils.formatIps(55.8), '55,80');
    assert.equal(utils.formatIps(0), 'sem dado');
    assert.equal(utils.formatIps(null), 'sem dado');
});

test('IPS municipal - cobre os 5.570 municípios com código IBGE válido', () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ips_brazil_cities_2026.json'), 'utf8'));

    const codes = Object.keys(data.cities);
    assert.equal(codes.length, 5570);
    assert.equal(data.count, 5570);

    for (const code of codes) {
        assert.match(code, /^\d{7}$/, `código IBGE inválido: ${code}`);
    }

    const ranks = new Set();
    for (const [code, row] of Object.entries(data.cities)) {
        assert.ok(row.ips > 0 && row.ips <= 100, `IPS fora da escala em ${code}`);
        assert.ok(row.rank >= 1 && row.rank <= 5570, `ranking fora do intervalo em ${code}`);
        assert.ok(!ranks.has(row.rank), `ranking repetido: ${row.rank}`);
        ranks.add(row.rank);
        assert.deepEqual(Object.keys(row.dimensions).sort(), ['basicNeeds', 'opportunity', 'wellbeing']);
    }
    assert.equal(ranks.size, 5570);
});

test('IPS municipal - notas conferem com os municípios citados no relatório', () => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ips_brazil_cities_2026.json'), 'utf8'));

    // Âncoras dos quadros de melhores/piores desempenhos do relatório geral.
    assert.equal(data.cities['3516853'].ips, 73.10); // Gavião Peixoto (SP), melhor do país
    assert.equal(data.cities['3516853'].rank, 1);
    assert.equal(data.cities['3525904'].ips, 71.80); // Jundiaí (SP)
    assert.equal(data.cities['3543402'].ips, 70.80); // Ribeirão Preto (SP)
    assert.equal(data.cities['1501808'].ips, 49.66); // Breves (PA)
    assert.equal(data.cities['1501253'].ips, 47.23); // Bannach (PA)

    // A média ponderada por população é como o relatório define a nota do Brasil.
    // Aqui checamos o efeito disso: o topo e a base batem com o intervalo publicado.
    const values = Object.values(data.cities).map((row) => row.ips);
    assert.equal(Math.max(...values), 73.10);
    assert.ok(Math.min(...values) >= 40 && Math.min(...values) < 50);
});

test('IPS - cidade usa dado municipal real, e proxy da UF só como fallback', () => {
    const cityData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ips_brazil_cities_2026.json'), 'utf8'));
    utils.mergeIpsBrazil(loadIpsData());
    utils.setActiveIpsYear('2026');
    utils.mergeIpsBrazilCities(cityData);

    // Município que existe na base: valor real, com ranking nacional.
    const saoPaulo = utils.cityMapPropertiesForTests({ id: '3550308', uf: 'SP', stateId: '35', pop: 11451245 });
    assert.equal(saoPaulo.ipsReal, true);
    assert.equal(saoPaulo.ipsProxy, false);
    assert.equal(saoPaulo.ips, cityData.cities['3550308'].ips);
    assert.ok(saoPaulo.ipsRank >= 1 && saoPaulo.ipsRank <= 5570);

    // Município fora da base cai no IPS da UF e é marcado como proxy.
    utils.seedStateForTests({ id: '35', sigla: 'SP', nome: 'São Paulo', ips: 67.96, ipsRank: 2 });
    const inexistente = utils.cityMapPropertiesForTests({ id: '9999999', uf: 'SP', stateId: '35', pop: 1000 });
    assert.equal(inexistente.ipsReal, false);
    assert.equal(inexistente.ipsProxy, true);
    assert.equal(inexistente.ips, 67.96);
});

test('IPS - o mapa lê o campo do indicador ativo (dropdown da legenda)', () => {
    utils.setActiveAnalysis('ips');
    utils.setActiveIpsSubMetric('ipsGeral');
    assert.equal(utils.ipsMetricField(), 'ips');
    assert.deepEqual(utils.analysisMetricExpression(), ['to-number', ['get', 'ips'], 0]);

    // As 3 dimensões viram campos achatados nas properties do mapa.
    utils.setActiveIpsSubMetric('basicNeeds');
    assert.equal(utils.ipsMetricField(), 'ipsBasicNeeds');
    utils.setActiveIpsSubMetric('wellbeing');
    assert.equal(utils.ipsMetricField(), 'ipsWellbeing');
    utils.setActiveIpsSubMetric('opportunity');
    assert.equal(utils.ipsMetricField(), 'ipsOpportunity');
    assert.deepEqual(utils.analysisMetricExpression(), ['to-number', ['get', 'ipsOpportunity'], 0]);

    // Indicador desconhecido não pode quebrar o mapa: cai no IPS geral.
    utils.setActiveIpsSubMetric('naoExiste');
    assert.equal(utils.ipsMetricField(), 'ips');

    utils.setActiveIpsSubMetric('ipsGeral');
    utils.setActiveAnalysis('general');
});

test('IPS - cada indicador tem cortes de classe na sua própria faixa', () => {
    const data = loadIpsData();
    assert.equal(data.classCount, 9);

    const keys = ['ips', 'basicNeeds', 'wellbeing', 'opportunity'];
    for (const key of keys) {
        const entry = data.classBreaks[key];
        assert.ok(entry, `sem cortes para ${key}`);
        assert.equal(entry.breaks.length, 8, `${key} devia ter 8 cortes para 9 classes`);
        for (let i = 1; i < entry.breaks.length; i++) {
            assert.ok(entry.breaks[i] > entry.breaks[i - 1], `cortes de ${key} não são crescentes`);
        }
    }

    // O ponto do bug: dimensões vivem em faixas diferentes. Se todas usassem os
    // cortes do IPS geral, Necessidades ficaria toda no topo e Oportunidades no fundo.
    // As faixas podem até se tocar nas pontas; o que importa é o centro de cada uma.
    const center = (key) => {
        const list = data.classBreaks[key].breaks;
        return (list[Math.floor((list.length - 1) / 2)] + list[Math.ceil((list.length - 1) / 2)]) / 2;
    };
    assert.ok(center('basicNeeds') > center('ips'), 'Necessidades Básicas fica acima da faixa do IPS geral');
    assert.ok(center('ips') > center('opportunity'), 'Oportunidades fica abaixo da faixa do IPS geral');
    assert.ok(center('basicNeeds') - center('opportunity') > 20, 'a distância entre as dimensões justifica cortes próprios');
});

// Aplica uma expressão ["step", input, c0, s1, c1, ...] como o MapLibre faria.
function applyStepExpression(expression, value) {
    assert.equal(expression[0], 'step', 'o IPS tem que usar mapa classificado, não gradiente');
    let color = expression[2];
    for (let i = 3; i < expression.length; i += 2) {
        if (value >= expression[i]) color = expression[i + 1];
    }
    return color;
}

test('IPS - a expressão de cor do mapa gera classes distintas entre as UFs', () => {
    const data = loadIpsData();
    utils.mergeIpsBrazil(data);
    utils.setActiveIpsYear('2026');
    utils.setActiveAnalysis('ips');

    const values = Object.values(data.states).map((row) => row.byYear['2026'].ips);

    for (const metric of ['ipsGeral', 'basicNeeds', 'wellbeing', 'opportunity']) {
        utils.setActiveIpsSubMetric(metric);
        const expression = utils.territoryHeatColorExpression('state');
        const metricValues = metric === 'ipsGeral'
            ? values
            : Object.values(data.states).map((row) => row.byYear['2026'].dimensions[metric]);
        const colors = new Set(metricValues.map((value) => applyStepExpression(expression, value)));
        assert.ok(colors.size >= 5, `${metric}: esperava >=5 cores distintas nas UFs, veio ${colors.size}`);
    }

    utils.setActiveIpsSubMetric('ipsGeral');
    utils.setActiveAnalysis('general');
});

test('IPS - sem classBreaks no JSON (cache antigo), os cortes são derivados do dado', () => {
    const data = loadIpsData();
    utils.mergeIpsBrazil(data);
    utils.setActiveIpsYear('2026');
    utils.mergeIpsBrazilCities(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ips_brazil_cities_2026.json'), 'utf8')));

    utils.setActiveAnalysis('ips');

    // Simula o JSON velho em cache: sem classBreaks.
    utils.dropIpsClassBreaksForTests();

    // Sem a derivação, uma dimensão cairia nos cortes do IPS geral (48-66) e
    // achataria o mapa. Com ela, os cortes têm que cair na faixa da dimensão.
    utils.setActiveIpsSubMetric('basicNeeds');
    const breaks = utils.ipsClassBreaks();
    assert.equal(breaks.length, 8);
    assert.ok(breaks[0] > 55, `corte inferior deveria ficar na faixa de Necessidades Básicas, veio ${breaks[0]}`);
    assert.ok(breaks[breaks.length - 1] > 70, `corte superior deveria passar de 70, veio ${breaks[breaks.length - 1]}`);

    const values = Object.values(data.states).map((row) => row.byYear['2026'].dimensions.basicNeeds);
    const expression = utils.territoryHeatColorExpression('state');
    const colors = new Set(values.map((value) => applyStepExpression(expression, value)));
    assert.ok(colors.size >= 5, `mesmo sem classBreaks o mapa tem que ter contraste, veio ${colors.size}`);

    utils.setActiveIpsSubMetric('ipsGeral');
    utils.setActiveAnalysis('general');
});

test('IPS - as classes separam de fato as UFs (regressão do mapa homogêneo)', () => {
    const data = loadIpsData();
    const breaks = data.classBreaks.ips.breaks;
    const classOf = (value) => breaks.reduce((acc, limit) => (value >= limit ? acc + 1 : acc), 0);

    const values = Object.values(data.states).map((row) => row.byYear['2026'].ips);
    const classes = new Set(values.map(classOf));

    // Antes, o gradiente contínuo jogava 20 das 27 UFs numa faixa cinza-oliva quase
    // idêntica. Com classes discretas, tem que sobrar contraste visível.
    assert.ok(classes.size >= 5, `esperava pelo menos 5 classes distintas entre as UFs, veio ${classes.size}`);

    // E as médias dos 9 grupos oficiais do relatório caem cada uma na sua classe.
    const officialMeans = [46.50, 50.56, 53.44, 55.80, 57.93, 59.83, 61.89, 64.21, 68.37];
    const officialClasses = officialMeans.map(classOf);
    assert.deepEqual(officialClasses, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('Multi-moeda - getBrlValueInActiveCurrency e getUsdValueInActiveCurrency com câmbio fixo de 5.0', () => {
    // Configura moeda ativa como BRL
    utils.setActiveCurrency("BRL");
    assert.equal(utils.getActiveCurrency(), "BRL");
    assert.equal(utils.getBrlValueInActiveCurrency(100), 100);
    assert.equal(utils.getUsdValueInActiveCurrency(100), 500); // 100 USD = 500 BRL

    // Configura moeda ativa como USD
    utils.setActiveCurrency("USD");
    assert.equal(utils.getActiveCurrency(), "USD");
    assert.equal(utils.getBrlValueInActiveCurrency(100), 20); // 100 BRL / 5 = 20 USD
    assert.equal(utils.getUsdValueInActiveCurrency(100), 100);

    // Restaura o padrão para BRL
    utils.setActiveCurrency("BRL");
});

test('Multi-moeda - formatCurrency e formatCurrencyShort em Reais (BRL) e Dólares (USD)', () => {
    // Padrão BRL ativo
    utils.setActiveCurrency("BRL");

    // Dados do Brasil (nativos BRL) em Reais (BRL)
    const formattedBrl = utils.formatCurrency(1250, "BRL");
    assert.ok(formattedBrl.includes("R$"));
    assert.ok(formattedBrl.includes("1.250"));

    assert.equal(utils.formatCurrencyShort(1500000, "BRL"), "R$ 1,5 mi");
    assert.equal(utils.formatCurrencyShort(2500000000, "BRL"), "R$ 2,5 bi");
    assert.equal(utils.formatCurrencyShort(1200000000000, "BRL"), "R$ 1,20 tri");

    // Dados Globais (nativos USD) em Reais (BRL)
    const formattedWorldInBrl = utils.formatCurrency(100, "USD");
    assert.ok(formattedWorldInBrl.includes("R$"));
    assert.ok(formattedWorldInBrl.includes("500")); // 100 USD * 5 = 500 BRL
    assert.equal(utils.formatCurrencyShort(200000, "USD"), "R$ 1 mi"); // 200k USD * 5 = 1M BRL
    
    // Trocando a moeda ativa para USD
    utils.setActiveCurrency("USD");

    // Dados do Brasil (nativos BRL) em Dólares (USD)
    const formattedBrlInUsd = utils.formatCurrency(500, "BRL");
    assert.ok(formattedBrlInUsd.includes("$"));
    assert.ok(formattedBrlInUsd.includes("100")); // 500 BRL / 5 = 100 USD

    assert.equal(utils.formatCurrencyShort(5000000, "BRL"), "US$ 1 mi"); // 5M BRL / 5 = 1M USD
    
    // Dados Globais (nativos USD) em Dólares (USD)
    const formattedWorldInUsd = utils.formatCurrency(100, "USD");
    assert.ok(formattedWorldInUsd.includes("$"));
    assert.ok(formattedWorldInUsd.includes("100"));
    assert.equal(utils.formatCurrencyShort(1000000, "USD"), "US$ 1 mi");

    // Restaura o padrão para BRL
    utils.setActiveCurrency("BRL");
});

