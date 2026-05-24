import * as parserNamespace from '@babel/parser/lib/index.js';

const parserModule = parserNamespace.default ?? parserNamespace;

export const parse = parserModule.parse;
export const parseExpression = parserModule.parseExpression;
export const tokTypes = parserModule.tokTypes;

export default parserModule;
