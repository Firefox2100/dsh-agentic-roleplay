#!/usr/bin/env python3
"""Second pass: ask the model, for each link on its own, what the event does to the claim; drop links it disagrees with.
usage: signcheck35.py <claims.json> <events-4.json> <out claims.json>"""
import json, sys, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
src, evf, dst = sys.argv[1:4]
URL = os.environ.get('LOCALAI', 'http://localhost:8081/v1/chat/completions')
d = json.load(open(src)); ev = {e['id']: e for e in json.load(open(evf))}
schema = {'type': 'object', 'additionalProperties': False, 'required': ['effect'], 'properties': {
    'effect': {'type': 'string', 'enum': ['makes_true', 'makes_false', 'raises_chance', 'lowers_chance', 'unrelated']}}}
def ask(claim, e):
    p = f"""A story event and a claim. Assume the event really happened as written. What does it do to the claim?
CLAIM: {claim}
EVENT: {e['text']}
Answer with one of: makes_true (the claim must be true), makes_false (the claim must be false), raises_chance, lowers_chance, unrelated. Note that someone saying or theorising something only shows it was said. Return JSON."""
    body = {'model': 'qwen3.6-35b-a3b-uncensored-1m', 'reasoning_effort': 'none', 'temperature': 0, 'max_tokens': 60,
            'messages': [{'role': 'user', 'content': p}],
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'r', 'strict': True, 'schema': schema}}}
    r = json.load(urllib.request.urlopen(urllib.request.Request(URL, json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer dummy'}), timeout=300))
    return json.loads(r['choices'][0]['message']['content'])['effect']
OK = {'confirms': {'makes_true'}, 'contradicts': {'makes_false'}, 'supports': {'makes_true', 'raises_chance'}, 'undermines': {'makes_false', 'lowers_chance'}}
jobs = [(c['id'], i, c['text'], b) for c in d['claims'] for i, b in enumerate(c.get('bears_on', [])) if b['ref'] in ev]
with ThreadPoolExecutor(4) as ex:
    eff = list(ex.map(lambda j: ask(j[2], ev[j[3]['ref']]), jobs))
drop = {(j[0], j[1]) for j, e in zip(jobs, eff) if e not in OK[j[3]['as']]}
for c in d['claims']:
    c['bears_on'] = [b for i, b in enumerate(c.get('bears_on', [])) if (c['id'], i) not in drop]
json.dump(d, open(dst, 'w'), indent=1)
print(f'{len(jobs)} links asked, {len(drop)} dropped')
