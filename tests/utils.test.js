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

