const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
