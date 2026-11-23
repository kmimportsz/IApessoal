// Rational arithmetic with bounded inputs. The grammar accepts no identifiers or code.
export function calculate(input) {
  if (typeof input !== 'string' || input.length > 160) throw Error('Use até 160 caracteres.');
  const normalized = input.replace(/\s+/g, '').replace(/,/g, '.');
  const parts = normalized.match(/\d+(?:\.\d+)?|[-+*/()%]/g) ?? [];
  if (!parts.length || parts.length > 64 || parts.join('') !== normalized) throw Error('Expressão inválida.');
  let at=0;
  function rational(n,d=1n) {
    if (!d) throw Error('Divisão por zero.');
    if (d<0n) {n=-n;d=-d;}
    let a=n<0n?-n:n,b=d;
    while(b) [a,b]=[b,a%b];
    n/=a;d/=a;
    if (n.toString().length>100 || d.toString().length>100) throw Error('Resultado fora dos limites.');
    return [n,d];
  }
  function factor(depth) {
    if(depth>16) throw Error('Expressão com aninhamento excessivo.');
    const token=parts[at++];
    let pair;
    if(token==='-' || token==='+') {
      const [n,d]=factor(depth+1); pair=[token==='-'?-n:n,d];
    } else if(token==='(') {
      pair=expression(depth+1);
      if(parts[at++]!==')') throw Error('Parênteses inválidos.');
    } else if(token && /^\d{1,16}(?:\.\d{1,10})?$/.test(token)){
      const [whole,fraction='']=token.split('.');
      pair=rational(BigInt(whole+fraction),10n**BigInt(fraction.length));
    } else throw Error('Número ou operador inválido.');
    if(parts[at]==='%'){at++;pair=rational(pair[0],pair[1]*100n);}
    return pair;
  }
  function term(depth) {
    let [n,d]=factor(depth);
    while(parts[at]==='*'||parts[at]==='/'){
      const op=parts[at++],[x,y]=factor(depth);
      [n,d]=op==='*'?rational(n*x,d*y):rational(n*y,d*x);
    }
    return [n,d];
  }
  function expression(depth) {
    let [n,d]=term(depth);
    while(parts[at]==='+'||parts[at]==='-'){
      const op=parts[at++],[x,y]=term(depth);
      [n,d]=rational(n*y+(op==='+'?x:-x)*d,d*y);
    }
    return [n,d];
  }
  const [n,d]=expression(0);
  if(at!==parts.length) throw Error('Operadores inválidos.');
  const scale=100000000n, abs=n<0n?-n:n, digits=((abs*scale+d/2n)/d).toString().padStart(9,'0');
  const fractional=digits.slice(-8).replace(/0+$/,'');
  return {expression:normalized, exact:d===1n?n.toString():n+'/'+d,
    decimal:(n<0n?'-':'')+digits.slice(0,-8)+(fractional?','+fractional:''),
    rounded:(abs*scale)%d!==0n};
}

export const calculatorTool = {type:'function',function:{name:'calculate',description:'Calcula uma expressão aritmética com +, -, *, /, %, parênteses. Use apenas quando todos os operandos estiverem claros. % é divisão por 100.',
  parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression'],additionalProperties:false}}};
