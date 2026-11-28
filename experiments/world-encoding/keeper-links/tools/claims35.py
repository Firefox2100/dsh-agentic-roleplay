#!/usr/bin/env python3
"""Per-scene claim detection on the product's model. For each of four cumulative slices, show the NEW events only plus the claims found so far, and ask for new claims.
usage: claims35.py <input dir> <out dir>   -> out dir/claims-K.json (cumulative, same shape as input/claims-K.json)"""
import json, sys, os, urllib.request
inp, outd = sys.argv[1:3]
URL = os.environ.get('LOCALAI', 'http://localhost:8081/v1/chat/completions')
os.makedirs(outd, exist_ok=True)
people = json.load(open(f'{inp}/people.json')) if os.path.exists(f'{inp}/people.json') else []
schema = {'type': 'object', 'additionalProperties': False, 'required': ['claims'], 'properties': {'claims': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['id', 'text', 'by', 'asserted_in'],
    'properties': {'id': {'type': 'string'}, 'text': {'type': 'string'}, 'by': {'type': 'string'}, 'asserted_in': {'type': 'string'}}}}}}
def call(prompt):
    body = {'model': 'qwen3.6-35b-a3b-uncensored-1m', 'reasoning_effort': 'none', 'temperature': 0.2, 'max_tokens': 4000,
            'messages': [{'role': 'user', 'content': prompt}],
            'response_format': {'type': 'json_schema', 'json_schema': {'name': 'r', 'strict': True, 'schema': schema}}}
    r = json.load(urllib.request.urlopen(urllib.request.Request(URL, json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer dummy'}), timeout=900))
    return json.loads(r['choices'][0]['message']['content'])['claims']
found, seen = [], set()
for k in range(1, 5):
    ev = json.load(open(f'{inp}/events-{k}.json'))
    new = [e for e in ev if e['id'] not in seen]
    seen |= {e['id'] for e in ev}
    ids = {e['id'] for e in ev}
    pid = ', '.join(p['id'] for p in people)
    prompt = f"""You are the keeper of a story. Events are what happened (true). A CLAIM is something a person asserts, believes, suspects or theorises whose truth the events do not simply give: a belief a character could be right or wrong about, a theory, a testimony that may be mistaken, a plan's premise. Not every sentence is a claim: skip plain facts and trivia.

PEOPLE (ids): {pid}

CLAIMS ALREADY FOUND (do not repeat):
""" + '\n'.join(f"{c['id']}: {c['text']}" for c in found) + """

NEW EVENTS IN THIS SCENE:
""" + '\n'.join(f"{e['id']} [{e['kind']}] who={','.join(w['id'] for w in e.get('who', []))}: {e['text']}" for e in new) + """

List new claims asserted in these events: id (c-short-name), text (the claim as the person would put it, one sentence), by (a person id from the list), asserted_in (one of the new event ids). Only claims a game master would need to judge a character as right or wrong about. If none, return an empty list. JSON only."""
    for c in call(prompt):
        if c['asserted_in'] in ids and c['id'] not in {x['id'] for x in found}: found.append(c)
    json.dump(list(found), open(f'{outd}/claims-{k}.json', 'w'), indent=1)
    print(f'slice {k}: {len(found)} claims so far', flush=True)
