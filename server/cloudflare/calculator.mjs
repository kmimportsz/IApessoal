export {calculate} from '../../mobile/calculator.mjs';

export const calculatorTool = {type:'function',function:{name:'calculate',description:'Calcula uma expressão aritmética com +, -, *, /, %, parênteses. Use apenas quando todos os operandos estiverem claros. % é divisão por 100.',
  parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression'],additionalProperties:false}}};
