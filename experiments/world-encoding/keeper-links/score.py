#!/usr/bin/env python3
"""Score a keeper's claims and links against the Speckled Band key.
usage: score.py claims.json [--map mapping.json] [--cap-rivals N] [--no-rivals] [--cap-assertions | --drop-assertions] [--two]
  --map              keeper claim id -> my claim id, for runs that found their own claims
  --cap-rivals N     drop rival sets with more than N claims
  --no-rivals        drop every rival set
  --cap-assertions   links to speech/inference/testimony/inquiry events may only support or undermine
  --drop-assertions  remove links to those events
  --two              a verdict of true/false needs two decisive links (one gives likely/unlikely)"""
import json, sys, os, argparse
ap = argparse.ArgumentParser(); ap.add_argument('claims'); ap.add_argument('--map'); ap.add_argument('--cap-rivals', type=int)
ap.add_argument('--no-rivals', action='store_true'); ap.add_argument('--cap-assertions', action='store_true'); ap.add_argument('--drop-assertions', action='store_true'); ap.add_argument('--two', action='store_true')
args = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..', 'speckled-band', 'v2')
story = json.load(open(os.path.join(root, 'story.json')))
key = json.load(open(os.path.join(root, 'checks.json')))
out = json.load(open(args.claims))
mapping = json.load(open(args.map)) if args.map else None

seq = {e['id']: e['when']['seq'] for e in story['events']}
known = {e['id']: max(e['when']['seq'], seq.get(e.get('established_in'), float('inf'))) if 'established_in' in e else e['when']['seq'] for e in story['events']}

def derive(b):
    if args.two:
        n = lambda a: sum(x['as'] == a for x in b)
        b = [{'as': 'confirms'}] * (n('confirms') // 2) + [{'as': 'supports'}] * (n('confirms') % 2 + n('supports')) + [{'as': 'contradicts'}] * (n('contradicts') // 2) + [{'as': 'undermines'}] * (n('contradicts') % 2 + n('undermines'))
    has = lambda a: any(x['as'] == a for x in b)
    if has('confirms') and has('contradicts'): return 'disputed'
    if has('contradicts'): return 'false'
    if has('confirms'): return 'true'
    if has('supports') and has('undermines'): return 'open'
    if has('supports'): return 'likely'
    if has('undermines'): return 'unlikely'
    return 'unresolved'

def verdicts(claims, questions, at=float('inf')):
    by = {c['id']: c for c in claims}
    def own(c):
        made = known.get(c['asserted_in'], -float('inf'))
        return [b for b in c.get('bears_on', []) if b['ref'] in known and max(made, known[b['ref']]) <= at]
    res = {}
    for c in claims:
        if 'parts' in c:
            each = [derive([b for b in p['bears_on'] if b['ref'] in known and max(known.get(c['asserted_in'], -float('inf')), known[b['ref']]) <= at]) for p in c['parts']]
            res[c['id']] = each[0] if all(v == each[0] for v in each) else 'mixed'
            continue
        riv = [r for q in questions if c['id'] in q['rivals'] for r in q['rivals'] if r != c['id'] and r in by]
        rv = [derive(own(by[r])) for r in riv]
        extra = [{'as': 'contradicts'} for v in rv if v == 'true'] + [{'as': 'undermines'} for v in rv if v == 'likely']
        res[c['id']] = derive(own(c) + extra)
    return res

claims = out['claims']; questions = out.get('questions', [])
if args.no_rivals: questions = []
if args.cap_rivals is not None: questions = [q for q in questions if 2 <= len(q['rivals']) <= args.cap_rivals]
ASSERT = {'speech', 'inference', 'testimony', 'inquiry', 'writes'}
kind = {e['id']: e['kind'] for e in story['events']}
for c in claims:
    if args.drop_assertions: c['bears_on'] = [b for b in c.get('bears_on', []) if kind.get(b['ref']) not in ASSERT]
    if args.cap_assertions:
        for b in c.get('bears_on', []):
            if kind.get(b['ref']) in ASSERT: b['as'] = {'confirms': 'supports', 'contradicts': 'undermines'}.get(b['as'], b['as'])
if mapping:
    claims = [dict(c, id=mapping[c['id']]) for c in claims if mapping.get(c['id'])]
    questions = [dict(q, rivals=[mapping[r] for r in q['rivals'] if mapping.get(r)]) for q in questions]
got = verdicts(claims, questions)
exp = key['expected_verdicts']
mine = {c['id']: c for c in story['claims']}
rank = {'false': -2, 'unlikely': -1, 'unresolved': 0, 'open': 0, 'disputed': 0, 'mixed': 0, 'likely': 1, 'true': 2}
rows = []
for cid, e in exp.items():
    g = got.get(cid, 'MISSING')
    if g == e: k = 'same'
    elif g == 'MISSING': k = 'missing'
    elif rank[g] * rank[e] < 0: k = 'FLIP'
    elif (rank[g] == 0) != (rank[e] == 0): k = 'resolved<->open'
    else: k = 'strength'
    rows.append((cid, e, g, k))
for r in rows: print('%-28s key=%-10s got=%-10s %s' % r)
from collections import Counter
print(Counter(r[3] for r in rows))

# link level
def links(cs):
    s = set()
    for c in cs:
        for b in c.get('bears_on', []): s.add((c['id'], b['ref'], b['as']))
        for p in c.get('parts', []):
            for b in p['bears_on']: s.add((c['id'], b['ref'], b['as']))
    return s
M, K = links(story['claims']), links([c for c in claims if c['id'] in exp])
loose = lambda s: {(a, b) for a, b, _ in s}
pol = lambda a: 'pos' if a in ('confirms', 'supports') else 'neg'
polar = lambda s: {(a, b, pol(c)) for a, b, c in s}
def pr(a, b, name):
    tp = len(a & b)
    print('%-26s mine=%d keeper=%d both=%d  precision=%.2f recall=%.2f' % (name, len(a), len(b), tp, tp / max(len(b), 1), tp / max(len(a), 1)))
pr(M, K, 'exact (ref + strength)'); pr(polar(M), polar(K), 'ref + direction'); pr(loose(M), loose(K), 'ref only')
print('questions keeper:', [(q['id'], q['rivals']) for q in questions])
print('questions mine  :', [(q['id'], q['rivals']) for q in story['questions']])
