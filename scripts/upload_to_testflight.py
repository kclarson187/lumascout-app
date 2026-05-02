#!/usr/bin/env python3
"""
LumaScout — Direct iOS TestFlight upload pipeline.

Usage:
    python3 scripts/upload_to_testflight.py <EAS_BUILD_ID> <CFBundleShortVersionString> <CFBundleVersion>

Example:
    python3 scripts/upload_to_testflight.py 4705f9d5-0f7a-4cec-a5da-8f51fb837444 2.0.16 2.0.16

Why this script exists:
    `eas submit` for iOS started failing silently with "Something went wrong when submitting"
    and no error logs. We bypass it entirely by calling Apple's App Store Connect
    /v1/buildUploads API directly (added in 2024, multipart S3 upload). The .ipa is
    fetched from EAS's artifact URL, then chunk-uploaded straight to Apple's CDN.

Prerequisites:
    1. EAS build must be FINISHED (state=FINISHED).
    2. ASC API Key (.p8) must be at /app/secrets/AuthKey_<KEY_ID>.p8.
    3. Bundle ID in app.json MUST match the App Store Connect record's bundle ID
       (see ASC App > App Information). Otherwise Apple rejects with error 90055.
    4. Marketing version + buildNumber must be HIGHER than the latest existing build.
    5. PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS capabilities enabled on the bundle ID
       record in Apple Developer Portal (handled once via ASC API).
"""
import jwt, time, json, os, sys
import urllib.request, urllib.error

# === CONFIG (override via env) ===
KEY_ID = os.environ.get('ASC_KEY_ID', '73A3K9Z48T')
ISSUER = os.environ.get('ASC_ISSUER_ID', 'c0ede999-5ba4-41a4-9503-e1bbf6780c86')
KEY_PATH = os.environ.get('ASC_KEY_PATH', '/app/secrets/AuthKey_73A3K9Z48T.p8')
ASC_APP_ID = os.environ.get('ASC_APP_ID', '6762586637')
EXPO_TOKEN = os.environ.get('EXPO_TOKEN', 'c-WDrWead9spJlEHPrygNob74T9awty_Ap5Wpehx')

if len(sys.argv) < 4:
    print(__doc__)
    sys.exit(1)

EAS_BUILD_ID = sys.argv[1]
APP_VERSION = sys.argv[2]
BUILD_NUMBER = sys.argv[3]

with open(KEY_PATH) as f:
    PK = f.read()


def make_token():
    return jwt.encode(
        {'iss': ISSUER, 'iat': int(time.time()), 'exp': int(time.time()) + 1200, 'aud': 'appstoreconnect-v1'},
        PK, algorithm='ES256', headers={'kid': KEY_ID, 'typ': 'JWT'},
    )


def asc(method, path, body=None):
    h = {'Authorization': f'Bearer {make_token()}'}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(f'https://api.appstoreconnect.apple.com{path}', data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        body_resp = e.read().decode() or '{}'
        try:
            return e.code, json.loads(body_resp)
        except Exception:
            return e.code, body_resp


def fetch_ipa_url():
    query = """
    query($id: ID!) {
      builds {
        byId(buildId: $id) {
          id status
          artifacts { applicationArchiveUrl }
        }
      }
    }
    """
    body = json.dumps({"query": query, "variables": {"id": EAS_BUILD_ID}}).encode()
    req = urllib.request.Request(
        "https://api.expo.dev/graphql",
        data=body,
        headers={
            "Authorization": f"Bearer {EXPO_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "eas-cli/18.5.0 linux",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    build = d['data']['builds']['byId']
    if build['status'] != 'FINISHED':
        raise RuntimeError(f"Build {EAS_BUILD_ID} is not FINISHED (status={build['status']})")
    return build['artifacts']['applicationArchiveUrl']


def main():
    ipa_url = fetch_ipa_url()
    ipa_local = f'/tmp/lumascout-{APP_VERSION}.ipa'
    print(f'[1/6] Fetching IPA: {ipa_url}', flush=True)
    if not os.path.exists(ipa_local) or os.path.getsize(ipa_local) < 1024:
        req = urllib.request.Request(ipa_url, headers={'User-Agent': 'curl/7.81.0'})
        with urllib.request.urlopen(req, timeout=600) as r, open(ipa_local, 'wb') as f:
            total = 0
            while True:
                ch = r.read(1024 * 1024)
                if not ch:
                    break
                f.write(ch)
                total += len(ch)
            print(f'    Downloaded {total/(1024*1024):.1f} MB', flush=True)
    ipa_size = os.path.getsize(ipa_local)

    print(f'[2/6] Creating buildUpload (version={APP_VERSION}, build={BUILD_NUMBER})...', flush=True)
    s, d = asc('POST', '/v1/buildUploads', body={
        'data': {
            'type': 'buildUploads',
            'attributes': {
                'cfBundleShortVersionString': APP_VERSION,
                'cfBundleVersion': BUILD_NUMBER,
                'platform': 'IOS',
            },
            'relationships': {'app': {'data': {'type': 'apps', 'id': ASC_APP_ID}}},
        },
    })
    if s not in (200, 201):
        print(json.dumps(d, indent=2))
        sys.exit(1)
    upload_id = d['data']['id']
    print(f'    upload_id={upload_id}', flush=True)

    print('[3/6] Registering buildUploadFile...', flush=True)
    s, d = asc('POST', '/v1/buildUploadFiles', body={
        'data': {
            'type': 'buildUploadFiles',
            'attributes': {
                'fileName': 'lumascout.ipa',
                'fileSize': ipa_size,
                'assetType': 'ASSET',
                'uti': 'com.apple.ipa',
            },
            'relationships': {'buildUpload': {'data': {'type': 'buildUploads', 'id': upload_id}}},
        },
    })
    if s not in (200, 201):
        print(json.dumps(d, indent=2))
        sys.exit(1)
    file_id = d['data']['id']
    ops = d['data']['attributes'].get('uploadOperations') or []
    print(f'    file_id={file_id}, chunks={len(ops)}', flush=True)

    print(f'[4/6] Uploading {len(ops)} chunks ({ipa_size/(1024*1024):.1f} MB)...', flush=True)
    with open(ipa_local, 'rb') as f:
        for i, op in enumerate(ops):
            offset, length = op.get('offset', 0), op.get('length', 0)
            url, method = op['url'], op.get('method', 'PUT')
            req_headers = {h['name']: h['value'] for h in op.get('requestHeaders', [])}
            f.seek(offset)
            chunk = f.read(length)
            req = urllib.request.Request(url, data=chunk, method=method, headers=req_headers)
            with urllib.request.urlopen(req, timeout=300) as r:
                print(f'    chunk {i+1}/{len(ops)} OK ({length/(1024*1024):.1f} MB) status={r.status}', flush=True)

    print('[5/6] Marking file uploaded...', flush=True)
    s, d = asc('PATCH', f'/v1/buildUploadFiles/{file_id}', body={
        'data': {'type': 'buildUploadFiles', 'id': file_id, 'attributes': {'uploaded': True}}
    })
    if s >= 400:
        print(json.dumps(d, indent=2))
        sys.exit(1)

    print('[6/6] Polling buildUpload state (Apple takes 1-15 min to validate)...', flush=True)
    for i in range(60):
        time.sleep(15)
        s, d = asc('GET', f'/v1/buildUploads/{upload_id}')
        st = d.get('data', {}).get('attributes', {}).get('state', {}) or {}
        state = st.get('state')
        errs = st.get('errors', [])
        print(f'    [{i*15}s] state={state}', flush=True)
        if errs:
            print('    ERRORS:', json.dumps(errs, indent=2))
        if state == 'COMPLETE':
            print('\n✅ Build delivered to App Store Connect TestFlight.')
            return 0
        if state == 'FAILED':
            print('\n❌ Apple rejected the build.')
            return 1
    print('⏳ Still PROCESSING after 15 min — check ASC TestFlight UI.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
