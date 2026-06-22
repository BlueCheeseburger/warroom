// Stress test: two clients typing into the same cell with EVERY keystroke
// relayed live (the real per-input path), interleaved, to flush out divergence,
// dropped chars, or duplication under a tight feedback loop.
import * as Y from 'yjs';
import { seedDoc, cellText, setYText, REMOTE_ORIGIN, LOCAL_ORIGIN, FlowDocData } from '../src/lib/flowDoc';

let fail = 0;
const ok = (n: string, c: boolean, e='') => { console.log(`  ${c?'✓':'✗'} ${n}${c?'':'  → '+e}`); if(!c) fail++; };
const base: FlowDocData = { event:'policy', variant:'stock-issues', pfOrder:'pro-first',
  sheets:[{id:'s1',name:'S',cells:{},arrows:[]}], columnWidths:[185], customColumns:null, columnColors:[null], fontSize:13, zoom:100 };

function pair() {
  const A = new Y.Doc(); seedDoc(A, base, v=>v);
  const B = new Y.Doc(); Y.applyUpdate(B, Y.encodeStateAsUpdate(A), REMOTE_ORIGIN);
  A.on('update',(u,o)=>{ if(o!==REMOTE_ORIGIN) Y.applyUpdate(B,u,REMOTE_ORIGIN); });
  B.on('update',(u,o)=>{ if(o!==REMOTE_ORIGIN) Y.applyUpdate(A,u,REMOTE_ORIGIN); });
  return {A,B};
}

// Simulate a user typing a word char-by-char into their OWN local DOM string,
// pushing the whole new string each keystroke (exactly what handleInput does).
function typeInto(doc: Y.Doc, key: string, localStr: string, addition: string, atEnd=true) {
  for (const ch of addition) {
    localStr = atEnd ? localStr + ch : ch + localStr;
    setYText(cellText(doc, 's1', key)!, localStr, LOCAL_ORIGIN);
  }
  return localStr;
}

console.log('\n[A] two users append to the same cell, fully interleaved keystrokes');
{
  const {A,B} = pair();
  // Interleave: A types "AFF", B types "neg", one char each, alternating.
  let la = '', lb = '';
  const aw = 'AFF', bw = 'neg';
  for (let i=0; i<Math.max(aw.length,bw.length); i++) {
    if (i<aw.length){ la = (cellText(A,'s1','0-0')!.toString()); la+=aw[i]; setYText(cellText(A,'s1','0-0')!, la, LOCAL_ORIGIN); }
    if (i<bw.length){ lb = (cellText(B,'s1','0-0')!.toString()); lb+=bw[i]; setYText(cellText(B,'s1','0-0')!, lb, LOCAL_ORIGIN); }
  }
  const ca = cellText(A,'s1','0-0')!.toString(), cb = cellText(B,'s1','0-0')!.toString();
  ok('converge', ca===cb, `${ca} | ${cb}`);
  ok('all of AFF survives', [...'AFF'].every(c=>{const n=(ca.match(new RegExp(c==='F'?'F':c,'g'))||[]).length; return true;}) && ca.includes('A'));
  ok('all letters present (A,F,F,n,e,g)', ['A','F','n','e','g'].every(c=>ca.includes(c)), ca);
  ok('length == 6 (nothing dropped/dup)', ca.length===6, `len ${ca.length}: "${ca}"`);
}

console.log('\n[B] users edit two different cells, 50 rapid keystrokes each');
{
  const {A,B} = pair();
  let la='', lb='';
  for (let i=0;i<50;i++){
    la = typeInto(A,'0-0',la,'x');
    lb = typeInto(B,'1-0',lb,'y');
  }
  const a00=cellText(A,'s1','0-0')!.toString(), a10=cellText(A,'s1','1-0')!.toString();
  const b00=cellText(B,'s1','0-0')!.toString(), b10=cellText(B,'s1','1-0')!.toString();
  ok('cell 0-0 has 50 x on both', a00.length===50 && a00===b00, `${a00.length}/${b00.length}`);
  ok('cell 1-0 has 50 y on both', a10.length===50 && a10===b10, `${a10.length}/${b10.length}`);
}

console.log('\n[C] delete-in-the-middle while peer appends');
{
  const {A,B} = pair();
  setYText(cellText(A,'s1','0-0')!, 'topicality violation', LOCAL_ORIGIN);
  // A removes "violation ", B appends " 2NR" — concurrent, both relayed
  const cur = cellText(A,'s1','0-0')!.toString();
  setYText(cellText(A,'s1','0-0')!, 'topicality ', LOCAL_ORIGIN);            // delete tail
  setYText(cellText(B,'s1','0-0')!, cellText(B,'s1','0-0')!.toString()+' standards', LOCAL_ORIGIN);
  const a=cellText(A,'s1','0-0')!.toString(), b=cellText(B,'s1','0-0')!.toString();
  ok('converge after concurrent delete+append', a===b, `${a} | ${b}`);
  ok('append survived', a.includes('standards'), a);
}

console.log(`\n${fail===0?'✅ all stress checks passed':'❌ '+fail+' failed'}\n`);
process.exit(fail?1:0);
