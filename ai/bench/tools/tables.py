# The comparison tables of ai/research/benchmark.md (sections 4-8), from the stored results (no model calls):
#   python3 ai/bench/tools/tables.py plan | rounds | orounds | edit | refine | observe
import json,glob,statistics as st,collections,sys,os
B=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'results')+'/'
def recs(run,phase,cfg): return [json.load(open(f)) for f in sorted(glob.glob(f'{B}{run}/{phase}/{cfg}/*.json'))]
def pct(a,p):
  a=sorted(x for x in a if x is not None)
  if not a: return None
  i=(len(a)-1)*p; lo=int(i); hi=min(lo+1,len(a)-1); return a[lo]+(a[hi]-a[lo])*(i-lo)
def m(a):
  a=[x for x in a if x is not None]; return st.mean(a) if a else None
def f(v,d=2): return '–' if v is None else f'{v:.{d}f}'
def row(rs, target=lambda r:r):
  ok=[r for r in rs if r.get('call',{}).get('ok')]
  ms=[r['call']['ms']/1000 for r in ok]
  j=lambda k:[ (target(r) or {}).get('judge',{}).get(k,{}).get('score_0_10') if not r.get('judge') or True else None for r in rs]
  jo=[r.get('judge',{}).get('opus-high',{}).get('score_0_10') for r in rs]
  ja=[r.get('judge',{}).get('astra-high',{}).get('score_0_10') for r in rs]
  return dict(n=len(rs), ok=len(ok), rep=sum(1 for r in ok if r['call'].get('repaired')),
    det=m([(target(r) or {}).get('score',{}).get('score',0) for r in rs]), pas=m([1 if (target(r) or {}).get('score',{}).get('pass') else 0 for r in rs]),
    jo=m(jo), ja=m(ja), p50=pct(ms,.5), p90=pct(ms,.9),
    cost=m([r['call'].get('usage',{}).get('costInUSD') for r in ok]),
    out=m([r['call'].get('usage',{}).get('completion_tokens') for r in ok]))
cmd=sys.argv[1]
if cmd=='plan':
  for cfg,model,eff in [('opus-medium','claude-group/claude-opus-5-5','medium'),('opus-high','claude-group/claude-opus-5-5','high'),('opus-low','claude-group/claude-opus-5-5','low'),('fable-high','claude-group/claude-fable-5-1','high'),('sonnet-high','claude-group/claude-sonnet-5-5','high'),('argon-high','gemini-group/gemini-4-argon','high'),('astra-high','openai-group/gpt-6-astra','high'),('sol-high','openai-group/gpt-6.1-sol','high')]:
    r=row(recs('main','plan',cfg))
    print(f"| {model} | {eff} | {r['n']} | {r['ok']} | {r['rep']} | {f(r['det'],3)} | {f(r['pas'])} | {f(r['ja'])} | {f(r['jo'])} | {f(r['p50'],1)} | {f(r['p90'],1)} | {f(r['out'],0)} | {f(r['cost'],3)} |")
if cmd=='rounds':
  for label,runs,cfg in [('r0 (original)',['main','main-rep'],'opus-medium'),('r1',['prompt-plan-r1'],'opus-medium'),('r2',['prompt-plan-r2','prompt-plan-r2b'],'opus-medium'),('r3 (shipped)',['prompt-plan-r3','prompt-plan-r3b'],'opus-medium')]:
    out=[]
    for split in ['train','test']:
      rs=[x for run in runs for x in recs(run,'plan',cfg) if x['split']==split]
      r=row(rs); out.append(f"{f(r['det'],3)} / {f(r['pas'])} / {f(r['jo'])}")
    allr=row([x for run in runs for x in recs(run,'plan',cfg)])
    print(f"| {label} | {len(runs)} | {out[0]} | {out[1]} | {f(allr['p50'],1)} / {f(allr['p90'],1)} | {f(allr['out'],0)} |")
if cmd=='orounds':
  for label,obs,downs in [('obs-r0 (original)','main',['main','prompt-obs-r0b']),('obs-r1','prompt-obs-r1',['prompt-obs-r1','prompt-obs-r1b']),('obs-r2 (shipped)','prompt-obs-r2',['prompt-obs-r2','prompt-obs-r2b']),('obs-r3','prompt-obs-r3',['prompt-obs-r3','prompt-obs-r3b'])]:
    core=[e['id'] for e in json.load(open(B+'../images/index.json'))['images'] if e['kind']!='gt-render' or e.get('core')]
    cells=[]
    for split in ['train','test']:
      ob=[x for x in recs(obs,'observe','opus-low') if x['split']==split and x['case'] in core]
      mt=[x['metrics'] for x in ob if x.get('metrics')]
      ds=[x for run in downs for x in recs(run,'downstream','opus-low') if x['split']==split]
      r=row(ds)
      size=m([x['gt']['size']['mean_rel_err'] for x in ds if x.get('gt')])
      grp=f"{sum(g['exact'] for q in mt for g in q['groups'])}/{sum(1 for q in mt for g in q['groups'])}"
      cells.append(f"{f(m([q['recall'] for q in mt]))} / {f(m([q['mean_best_iou'] for q in mt]))} / {grp} | {f(r['det'],3)} / {f(r['pas'])} / {f(r['jo'])} / {f(size)}")
    ob=[x for x in recs(obs,'observe','opus-low') if x['case'] in core]
    rep=sum(1 for x in ob if x['call'].get('repaired')); ms=[x['call']['ms']/1000 for x in ob]
    print(f"| {label} | {cells[0]} | {cells[1]} | {rep}/{len(ob)} | {f(pct(ms,.5),1)} / {f(pct(ms,.9),1)} |")
if cmd=='edit':
  for cfg,model,eff in [('opus-low','claude-group/claude-opus-5-5','low'),('opus-medium','claude-group/claude-opus-5-5','medium'),('opus-high','claude-group/claude-opus-5-5','high'),('sonnet-low','claude-group/claude-sonnet-5-5','low'),('haiku-low','claude-group/claude-haiku-5-5','low'),('sol-low','openai-group/gpt-6.1-sol','low'),('flash-low','gemini-group/gemini-3.8-flash','low')]:
    r=row(recs('main','edit',cfg))
    print(f"| {model} | {eff} | {r['n']} | {r['ok']} | {r['rep']} | {f(r['det'],3)} | {f(r['pas'])} | {f(r['ja'])} | {f(r['jo'])} | {f(r['p50'],1)} | {f(r['p90'],1)} | {f(r['out'],0)} | {f(r['cost'],3)} |")
if cmd=='refine':
  for cfg,model,eff in [('opus-medium','claude-group/claude-opus-5-5','medium'),('opus-low','claude-group/claude-opus-5-5','low'),('sonnet-medium','claude-group/claude-sonnet-5-5','medium'),('argon-low','gemini-group/gemini-4-argon','low'),('flash-low','gemini-group/gemini-3.8-flash','low'),('astra-medium','openai-group/gpt-6-astra','medium'),('sol-medium','openai-group/gpt-6.1-sol','medium')]:
    rs=recs('main','refine-r1-plan-opus-medium',cfg)+recs('main','refine-r1-downstream-opus-medium',cfg)
    ok=[x for x in rs if x['call']['ok']]
    bj=[]; aj=[]
    for x in rs:
      b=(x.get('before') or {}).get('judge') or {}
      a=x.get('judge',{}).get('opus-high',{}).get('score_0_10')
      bjv=b.get('opus-high',{}).get('score_0_10') if b else None
      if bjv is None:
        # image states: the downstream record's judge
        try: bjv=json.load(open(f"{B}main/downstream/opus-medium/{x['case']}.json"))['judge']['opus-high']['score_0_10']
        except Exception: bjv=None
      if a is not None and bjv is not None: bj.append(bjv); aj.append(a)
    fixed=sum(1 for x in ok if not x['before']['score']['pass'] and x['after']['score']['pass'])
    broke=sum(1 for x in ok if x['before']['score']['pass'] and not x['after']['score']['pass'])
    nfail=sum(1 for x in rs if not x['before']['score']['pass'])
    ms=[x['call']['ms']/1000 for x in ok]
    print(f"| {model} | {eff} | {len(rs)} | {len(ok)} | {f(m([x.get('delta') or 0 for x in ok]),3)} | {fixed}/{nfail} | {broke} | {f(m(aj) - m(bj) if aj else None)} | {f(m([1 if x.get('done') else 0 for x in ok]))} | {f(pct(ms,.5),1)} | {f(pct(ms,.9),1)} | {f(m([x['call']['usage'].get('costInUSD') for x in ok]),3)} |")
if cmd=='observe':
  for cfg,model,eff in [('opus-low','claude-group/claude-opus-5-5','low'),('opus-medium','claude-group/claude-opus-5-5','medium'),('opus-high','claude-group/claude-opus-5-5','high'),('argon-low','gemini-group/gemini-4-argon','low'),('argon-high','gemini-group/gemini-4-argon','high'),('astra-medium','openai-group/gpt-6-astra','medium'),('sol-medium','openai-group/gpt-6.1-sol','medium'),('flash-low','gemini-group/gemini-3.8-flash','low'),('none','(no observation: plan reads the picture)','')]:
    ob=recs('main','observe',cfg) if cfg!='none' else []
    mt=[x['metrics'] for x in ob if x.get('metrics')]
    first=[]
    for x in ob:
      fa=[a for a in x['call']['attempts'] if not a.get('repair')]
      if fa: first.append(fa[0]['ms']/1000)
    ds=recs('main','downstream',cfg)
    r=row(ds)
    size=m([x['gt']['size']['mean_rel_err'] for x in ds if x.get('gt')]); tf=m([x['gt']['types']['f1'] for x in ds if x.get('gt')])
    grp=f"{sum(g['exact'] for q in mt for g in q['groups'])}/{sum(1 for q in mt for g in q['groups'])}" if mt else '–'
    okc=sum(1 for x in ob if x['call']['ok']); rep=sum(1 for x in ob if x['call'].get('repaired'))
    print(f"| {model} | {eff} | {okc}/{len(ob)} | {rep} | {f(m([q['recall'] for q in mt]))} | {f(m([q['mean_best_iou'] for q in mt]))} | {grp} | {f(pct(first,.5),1)} / {f(pct(first,.9),1)} | {f(r['det'],3)} | {f(r['pas'])} | {f(r['ja'])} | {f(r['jo'])} | {f(tf)} | {f(size)} | {f(m([x['call'].get('usage',{}).get('costInUSD') for x in ob if x['call']['ok']]),3) if ob else '–'} |")
