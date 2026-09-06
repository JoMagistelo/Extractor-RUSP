const LOWERCASE_CONNECTORS = new Set([
    'a', 'al', 'ante', 'bajo', 'con', 'contra', 'de', 'del', 'desde', 'durante',
    'e', 'el', 'en', 'entre', 'hacia', 'hasta', 'la', 'las', 'los', 'o', 'para',
    'por', 'según', 'sin', 'sobre', 'tras', 'u', 'un', 'una', 'unos', 'unas', 'y'
]);

const INSTITUTIONAL_ACRONYMS = new Set([
    'APF', 'ASF', 'CJF', 'CURP', 'IMSS', 'ISSSTE', 'OIC', 'RFC', 'RUSP', 'SABG',
    'SAT', 'SFP', 'SHCP', 'UR'
]);

function splitOuterPunctuation(token) {
    const match = String(token).match(/^([^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]*)(.*?)([^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]*)$/u);
    if (!match) return { prefix: '', core: String(token), suffix: '' };
    return { prefix: match[1], core: match[2], suffix: match[3] };
}

function capitalizeCore(core) {
    const lower = String(core).toLocaleLowerCase('es-MX');
    return lower.replace(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u, letter => letter.toLocaleUpperCase('es-MX'));
}

/**
 * Convierte textos institucionales escritos en mayúsculas sostenidas a una
 * capitalización legible. Mantiene artículos, preposiciones y conjunciones en
 * minúscula cuando no abren la frase, y conserva siglas institucionales.
 */
export function smartInstitutionalCase(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';

    return text.split(' ').map((token, index) => {
        const { prefix, core, suffix } = splitOuterPunctuation(token);
        if (!core) return token;

        const coreLower = core.toLocaleLowerCase('es-MX');
        const coreUpper = core.toLocaleUpperCase('es-MX');

        if (INSTITUTIONAL_ACRONYMS.has(coreUpper)) {
            return `${prefix}${coreUpper}${suffix}`;
        }

        if (/^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(core)) {
            return `${prefix}${coreUpper}${suffix}`;
        }

        if (index > 0 && LOWERCASE_CONNECTORS.has(coreLower)) {
            return `${prefix}${coreLower}${suffix}`;
        }

        return `${prefix}${capitalizeCore(core)}${suffix}`;
    }).join(' ');
}
