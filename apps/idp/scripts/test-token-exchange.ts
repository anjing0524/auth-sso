import 'dotenv/config';
import crypto from 'crypto';

const IDP_URL = 'http://localhost:4003';
const CLIENT_ID = 'portal';
const CLIENT_SECRET = process.env.PORTAL_CLIENT_SECRET || 'portal-secret'; // Assuming local dev
const REDIRECT_URI = 'http://localhost:4000/api/auth/callback';

async function testExchange() {
  console.log('1. Login to get session cookie');
  const loginRes = await fetch(`${IDP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Origin': IDP_URL,
    },
    body: JSON.stringify({ email: 'admin@example.com', password: 'test123456' }),
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
    return;
  }
  const cookies = loginRes.headers.get('set-cookie');
  console.log('Cookies received:', cookies?.substring(0, 50) + '...');
  
  console.log('\n2. Generate PKCE');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  
  console.log('\n3. Authorize to get code');
  const authUrl = new URL('/api/auth/oauth2/authorize', IDP_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('nonce', nonce);
  
  const authRes = await fetch(authUrl.toString(), {
    method: 'GET',
    headers: { 'Cookie': cookies || '' },
    redirect: 'manual' // We want to catch the 302
  });
  
  if (authRes.status !== 302) {
    console.error('Authorize failed, not 302. Status:', authRes.status);
    return;
  }
  
  const location = authRes.headers.get('location');
  console.log('Redirect Location:', location);
  
  const callbackUrl = new URL(location || '');
  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    console.error('No code found in redirect URL');
    return;
  }
  console.log('Code obtained:', code);
  
  console.log('\n4. Exchange Code for Token');
  const tokenUrl = new URL('/api/auth/oauth2/token', IDP_URL);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
  });
  
  const tokenRes = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  
  console.log('Token response status:', tokenRes.status);
  const text = await tokenRes.text();
  console.log('Token response body:', text);
}

testExchange().catch(console.error);
