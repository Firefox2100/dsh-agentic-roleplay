#!/usr/bin/env python3
"""Incremental keeper on the product's own model (LocalAI, thinking off).
usage: keeper35.py <input dir> <out dir> <chain id> <variant: plain|fix>
input dir holds brief.md and events-K.json / source-K.txt / claims-K.json for K=1..4 (see README)."""
import json, sys, os, re, urllib.request
inp, outd, chain, variant = sys.argv[1:5]
URL = os.environ.get('LOCALAI', 'http://localhost:8081/v1/chat/completions')
MODEL = 'qwen3.6-35b-a3b-uncensored-1m'
os.makedirs(outd, exist_ok=True)
brief = open(f'{inp}/brief.md').read()
FIX = """
SIGN RULE: `as` is always about the CLAIM exactly as worded. `confirms` means the event shows the claim itself is true; `contradicts` means the event shows the claim itself is false. If the event shows something that replaces or rules out the claim (for example the thing seen was really X, and the claim says it was Y), that is `contradicts`, not `confirms`. Before writing a link, say to yourself: 'if this event is true, is the claim true or false?'.
An event where a person says, argues or theorises something only shows that it was said: use `supports`/`undermines` for it, never `confirms`/`contradicts`, unless the event also states a plain fact.
"""

def call(prompt, schema, max_tokens=9000):
    body = {'model': MODEL, 'reasoning_effort': 'none', 'temperature': 0.2, 'max_tokens': max_tokens,
            'messages': [{'role': 'user', 'content': prompt}],
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'r', 'strict': True, 'schema': schema}}}
    req = urllib.request.Request(URL, json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer dummy'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=900))
            return json.loads(r['choices'][0]['message']['content'])
        except Exception as e:
            err = e
    raise err

bear = {'type': 'object', 'additionalProperties': False, 'required': ['ref', 'as'],
        'properties': {'ref': {'type': 'string'}, 'as': {'type': 'string', 'enum': ['confirms', 'contradicts', 'supports', 'undermines']}}}
schema = {'type': 'object', 'additionalProperties': False, 'required': ['claims', 'questions'], 'properties': {
    'claims': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'bears_on'], 'properties': {
        'id': {'type': 'string'}, 'bears_on': {'type': 'array', 'items': bear}}}},
    'questions': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'text', 'rivals'], 'properties': {
        'id': {'type': 'string'}, 'text': {'type': 'string'}, 'rivals': {'type': 'array', 'items': {'type': 'string'}}}}}}}

state = {}
for k in range(1, 5):
    ev = json.load(open(f'{inp}/events-{k}.json'))
    ids = {e['id'] for e in ev}
    claims = json.load(open(f'{inp}/claims-{k}.json'))
    src = open(f'{inp}/source-{k}.txt').read()
    evtxt = '\n'.join(f"{e['id']} [{e['kind']}] seq={e['when']['seq']}" + (f" (established in {e['established_in']})" if 'established_in' in e else '') + f" who={','.join(w['id'] for w in e.get('who', []))}: {e['text']}" for e in ev)
    prev = json.dumps({'claims': [{'id': i, 'bears_on': c} for i, c in state.get('links', {}).items()], 'questions': state.get('questions', [])}) if state else 'none yet'
    prompt = f"""{brief}
{FIX if variant == 'fix' else ''}
You are the keeper at one moment of the story. You see only what has happened so far.

EVENTS SO FAR:
{evtxt}

SOURCE TEXT SO FAR:
{src}

CLAIMS ASSERTED SO FAR (id | by | asserted in | text):
""" + '\n'.join(f"{c['id']} | {c['by']} | {c['asserted_in']} | {c['text']}" for c in claims) + f"""

YOUR EARLIER LINKS (keep what holds, add links from the new events, fix any that the new events show to be wrong):
{prev}

Write the full current state: for EVERY claim above its bears_on list (refs only to the event ids above), and the rival-claim questions. Return JSON only."""
    out = call(prompt, schema)
    links, dropped = {}, 0
    for c in out['claims']:
        good = [b for b in c['bears_on'] if b['ref'] in ids]
        dropped += len(c['bears_on']) - len(good)
        links[c['id']] = good
    state = {'links': links, 'questions': [q for q in out['questions']]}
    print(f'chain {chain} step {k}: {len(links)} claims, {sum(map(len, links.values()))} links, {dropped} bad refs', flush=True)

final = {'claims': [dict(c, bears_on=state['links'].get(c['id'], [])) for c in json.load(open(f'{inp}/claims-4.json'))], 'questions': state['questions']}
json.dump(final, open(f'{outd}/claims.json', 'w'), indent=1)
