import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const USERS_PATH = join(DATA_DIR, 'users.json');

const username = (process.env.ADMIN_USERNAME || '').trim();
const password = process.env.ADMIN_PASSWORD || '';
const displayName = (process.env.ADMIN_DISPLAYNAME || username).trim();

function fail(m) { console.error('ERRO: ' + m); process.exit(1); }

if (!username) fail('Defina ADMIN_USERNAME');
if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) fail('username invalido (3-32, letras/numeros/._-)');

const strong = password.length >= 8
  && /[A-Z]/.test(password)
  && /[0-9]/.test(password)
  && /[^A-Za-z0-9]/.test(password);
if (!strong) fail('Senha fraca: min 8, com 1 maiuscula, 1 numero e 1 caractere especial.');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let users = [];
if (existsSync(USERS_PATH)) {
  try { users = JSON.parse(readFileSync(USERS_PATH, 'utf-8')); }
  catch (e) { fail('users.json corrompido: ' + e.message); }
}

if (users.some(u => u.role === 'owner')) fail('Ja existe um owner. Seed abortado (idempotente).');
if (users.some(u => u.username === username)) fail('username ja existe.');

const id = 'usr_' + randomBytes(6).toString('base64url');
const passwordHash = bcrypt.hashSync(password, 12);

users.push({
  id, username, passwordHash,
  role: 'owner', active: true,
  createdAt: new Date().toISOString(),
  profile: {
    fullName: process.env.ADMIN_FULLNAME || '',
    displayName,
    phone: '',
    email: process.env.ADMIN_EMAIL || '',
  },
  integrations: {},
});

writeFileSync(USERS_PATH, JSON.stringify(users, null, 2) + '\n', 'utf-8');
console.log('OK: owner criado: ' + username + ' (id=' + id + ') -> ' + USERS_PATH);
