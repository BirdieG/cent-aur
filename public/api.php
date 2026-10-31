<?php
/*
 * Cent-aur server  -  plain PHP + SQLite. No service, no extra system user, no root.
 * Runs inside the normal website (Virtualmin / Apache + PHP) like any other PHP page.
 * Needs PHP 7.4 or newer with the "pdo_sqlite" module (standard on AlmaLinux / Virtualmin).
 * The web server sends every address that starts with /api/ to this file (see .htaccess).
 *
 * Each user's data is one JSON document. The page loads it after sign-in and saves it
 * back after every change. The first start creates the user "admin" with password "admin";
 * that password must be changed at the first sign-in.
 */
$VERSION = '2.0.2';
$CFG = array(
    'data_dir'        => '',   // empty = a folder "cent-aur-data" next to the website folder (outside the web)
    'ip_header'       => '',   // 'HTTP_CF_CONNECTING_IP' when the Cloudflare orange cloud is on
    'trusted_proxies' => null, // addresses allowed to set ip_header; null = Cloudflare's published ranges
    'session_days'    => 90,
);
if (is_file(__DIR__ . '/config.php')) {
    $c = include __DIR__ . '/config.php';
    if (is_array($c)) { $CFG = array_merge($CFG, $c); }
}
// Cloudflare's published ranges (https://www.cloudflare.com/ips/). Only these may tell us the visitor's address.
$CLOUDFLARE_IPS = array(
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
    '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
    '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
    '2a06:98c0::/29', '2c0f:f248::/32',
);
$MAX_DOC = 8 * 1024 * 1024;

// ------------------------------------------------------------------ small helpers
function now_ms() { return (int)round(microtime(true) * 1000); }
function is_https() {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
}
function jout($code, $obj, $cookie = null) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if ($cookie !== null) { send_cookie($cookie); }
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($code, $msg, $extra = array()) { jout($code, array_merge(array('error' => $msg), $extra)); }
// $tok = '' clears the cookie
function send_cookie($tok) {
    global $CFG;
    setcookie('ca_session', $tok, array(
        'expires' => $tok === '' ? 1 : time() + $CFG['session_days'] * 86400,
        'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax'));
}
function ip_in_range($ip, $cidr) {
    $p = explode('/', $cidr, 2);
    $a = @inet_pton($ip); $b = @inet_pton($p[0]);
    if ($a === false || $b === false || strlen($a) !== strlen($b)) { return false; }
    $bits = isset($p[1]) ? (int)$p[1] : strlen($a) * 8;
    $whole = intdiv($bits, 8); $rest = $bits % 8;
    if (strncmp($a, $b, $whole) !== 0) { return false; }
    if ($rest === 0) { return true; }
    $mask = (0xff << (8 - $rest)) & 0xff;
    return (ord($a[$whole]) & $mask) === (ord($b[$whole]) & $mask);
}
function client_ip() {
    global $CFG, $CLOUDFLARE_IPS;
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0';
    $h = $CFG['ip_header'];
    // the header is only believed when the request really comes from the proxy; anyone else could fake it
    if ($h && !empty($_SERVER[$h])) {
        $trusted = is_array($CFG['trusted_proxies']) ? $CFG['trusted_proxies'] : $CLOUDFLARE_IPS;
        foreach ($trusted as $r) {
            if (ip_in_range($ip, $r)) { $parts = explode(',', $_SERVER[$h]); $ip = trim($parts[0]); break; }
        }
    }
    return substr($ip, 0, 60);
}
function body_json() {
    global $MAX_DOC;
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') { return array(); }
    if (strlen($raw) > $MAX_DOC + 4096) { fail(413, 'Your data is too large to save.'); }
    $d = json_decode($raw, true);
    if (!is_array($d)) { fail(400, 'Bad request.'); }
    return $d;
}
function str_field($d, $k) { return isset($d[$k]) && is_string($d[$k]) ? $d[$k] : ''; }

// ------------------------------------------------------------------ database
function data_dir() {
    global $CFG;
    static $dir = null;
    if ($dir !== null) { return $dir; }
    $d = $CFG['data_dir'];
    if (!$d) {
        $root = !empty($_SERVER['DOCUMENT_ROOT']) ? rtrim($_SERVER['DOCUMENT_ROOT'], '/') : __DIR__;
        $d = dirname($root) . '/cent-aur-data';
    }
    if (!is_dir($d)) { @mkdir($d, 0700, true); }
    if (!is_dir($d) || !is_writable($d)) {
        fail(500, 'The data folder cannot be created or written: ' . $d . '. Create it in File Manager (or set data_dir in config.php).');
    }
    $dir = rtrim($d, '/');
    return $dir;
}
function db() {
    static $pdo = null;
    if ($pdo) { return $pdo; }
    $file = data_dir() . '/cent-aur.db';
    $new = !file_exists($file);
    $pdo = new PDO('sqlite:' . $file);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA busy_timeout=20000');
    $pdo->exec('PRAGMA foreign_keys=ON');
    if ($new) { @chmod($file, 0600); }
    $v = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($v === 0) { create_tables($pdo); }
    elseif ($v !== 2) { fail(500, 'The cent-aur-data folder is from the older version of Cent-aur. Delete that folder and open the site again.'); }
    return $pdo;
}
function q($sql, $args = array()) { $s = db()->prepare($sql); $s->execute($args); return $s; }
function q1($sql, $args = array()) { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function write_tx($fn) {
    $pdo = db();
    $pdo->exec('BEGIN IMMEDIATE');
    try { $r = $fn($pdo); $pdo->exec('COMMIT'); return $r; }
    catch (Exception $e) { $pdo->exec('ROLLBACK'); throw $e; }
}

// A new database file: the tables, and the administrator "admin" / "admin" (must choose a new password).
// user_version 2 marks this layout; 1 was the earlier offline/sync version, whose data is not carried over.
function create_tables($pdo) {
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $v = (int)$pdo->query('PRAGMA user_version')->fetchColumn();   // again, now that we hold the lock
        if ($v === 0) {
            $pdo->exec("CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)");
            $pdo->exec('CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL, seen INTEGER NOT NULL)');
            $pdo->exec('CREATE TABLE docs(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, rev INTEGER NOT NULL, updated INTEGER NOT NULL)');
            $pdo->exec('CREATE TABLE fails(k TEXT NOT NULL, t INTEGER NOT NULL)');
            $pdo->exec('CREATE INDEX fails_k ON fails(k, t)');
            $pdo->prepare("INSERT INTO users(username,pass,role,active,must_change,created) VALUES('admin',?,'admin',1,1,?)")->execute(array(pw_hash('admin'), now_ms()));
            $pdo->exec('PRAGMA user_version=2');
        }
        $pdo->exec('COMMIT');
    } catch (Exception $e) { $pdo->exec('ROLLBACK'); throw $e; }
}

// ------------------------------------------------------------------ passwords, sessions, limits
function pw_hash($pw) { return password_hash(base64_encode(hash('sha256', $pw, true)), PASSWORD_DEFAULT); }
function pw_check($pw, $stored) { return password_verify(base64_encode(hash('sha256', $pw, true)), $stored); }
function pw_problem($pw) {
    if (!is_string($pw) || mb_strlen($pw) < 8) { return 'The password must be at least 8 characters.'; }
    if (mb_strlen($pw) > 200) { return 'The password is too long.'; }
    if (strtolower($pw) === 'admin' || strtolower($pw) === 'password') { return 'Choose a password that is harder to guess.'; }
    return null;
}
function user_ok($n) { return is_string($n) && preg_match('/^[A-Za-z0-9._@\-]{2,40}$/', $n); }
// the version is only told to someone who is signed in; the page shows it at the bottom
function pub($u) { global $VERSION; return array('id' => (int)$u['id'], 'username' => $u['username'], 'role' => $u['role'], 'must_change' => (bool)$u['must_change'], 'version' => $VERSION); }
function user_for($tok) {
    global $CFG;
    if (!$tok) { return null; }
    $h = hash('sha256', $tok);
    $r = q1('SELECT s.seen AS seen, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=?', array($h));
    if (!$r || !$r['active']) { return null; }
    $t = now_ms();
    if ($t - (int)$r['seen'] > $CFG['session_days'] * 86400000) { q('DELETE FROM sessions WHERE hash=?', array($h)); return null; }
    if ($t - (int)$r['seen'] > 3600000) { q('UPDATE sessions SET seen=? WHERE hash=?', array($t, $h)); }
    return $r;
}
function limiter_blocked($ip, $user) {
    $since = time() - 600;
    q('DELETE FROM fails WHERE t<?', array(time() - 3600));
    $a = (int)q1('SELECT COUNT(*) AS n FROM fails WHERE k=? AND t>?', array('u|' . $ip . '|' . strtolower($user), $since))['n'];
    $b = (int)q1('SELECT COUNT(*) AS n FROM fails WHERE k=? AND t>?', array('i|' . $ip, $since))['n'];
    return $a >= 5 || $b >= 30;
}
function limiter_fail($ip, $user) {
    $t = time();
    q('INSERT INTO fails(k,t) VALUES(?,?)', array('u|' . $ip . '|' . strtolower($user), $t));
    q('INSERT INTO fails(k,t) VALUES(?,?)', array('i|' . $ip, $t));
}
function limiter_ok($ip, $user) { q('DELETE FROM fails WHERE k=?', array('u|' . $ip . '|' . strtolower($user))); }

function do_login($name, $pw, $ip) {
    if ($name === '' || $pw === '') { fail(400, 'Enter your user name and password.'); }
    if (limiter_blocked($ip, $name)) { fail(429, 'Too many wrong tries. Wait 10 minutes and try again.'); }
    $u = q1('SELECT * FROM users WHERE username=?', array($name));
    static $dummy = null; if ($dummy === null) { $dummy = pw_hash('not a real password'); }
    $ok = pw_check($pw, $u ? $u['pass'] : $dummy);
    if (!($u && $ok && $u['active'])) { limiter_fail($ip, $name); usleep(400000); fail(401, 'Wrong user name or password.'); }
    limiter_ok($ip, $name);
    $tok = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    $t = now_ms();
    q('INSERT INTO sessions(hash,user_id,created,seen) VALUES(?,?,?,?)', array(hash('sha256', $tok), $u['id'], $t, $t));
    jout(200, array('user' => pub($u)), $tok);
}

// Forgot the admin password: put "name:newpassword" in cent-aur-data/reset-admin.txt and open the site once.
function process_reset_file() {
    $f = data_dir() . '/reset-admin.txt';
    if (!is_file($f)) { return; }
    $line = trim((string)file_get_contents($f));
    @unlink($f);
    $p = strpos($line, ':');
    if ($p === false) { return; }
    $name = trim(substr($line, 0, $p)); $pw = trim(substr($line, $p + 1));
    if (!user_ok($name) || pw_problem($pw)) { return; }
    $h = pw_hash($pw);
    write_tx(function ($pdo) use ($name, $h) {
        $s = $pdo->prepare('SELECT id FROM users WHERE username=?'); $s->execute(array($name)); $id = $s->fetchColumn();
        if ($id) {
            $pdo->prepare("UPDATE users SET pass=?, role='admin', active=1, must_change=0 WHERE id=?")->execute(array($h, $id));
            $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute(array($id));
        } else {
            $pdo->prepare("INSERT INTO users(username,pass,role,active,must_change,created) VALUES(?,?,'admin',1,0,?)")->execute(array($name, $h, now_ms()));
        }
    });
}

// ------------------------------------------------------------------ the user's data
function get_data($uid) {
    $have = isset($_GET['rev']) ? (int)$_GET['rev'] : -1;
    if ($have >= 0) {
        $r = q1('SELECT rev FROM docs WHERE user_id=?', array($uid));
        $rev = $r ? (int)$r['rev'] : 0;
        if ($have === $rev) { jout(200, array('rev' => $rev, 'same' => true)); }
    }
    raw_out('{' . data_json($uid) . '}');
}
// "rev":..,"data":.. for one user; the stored text is already JSON, so it is sent as it is instead of decoded and encoded again
function data_json($uid) {
    $r = q1('SELECT data,rev FROM docs WHERE user_id=?', array($uid));
    return '"rev":' . ($r ? (int)$r['rev'] : 0) . ',"data":' . ($r ? $r['data'] : 'null');
}
function raw_out($json) {
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo $json;
    exit;
}
function put_data($uid) {
    global $MAX_DOC;
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > $MAX_DOC + 4096) { fail(413, 'Your data is too large to save.'); }
    $d = json_decode($raw);
    if (!is_object($d) || !isset($d->rev) || !is_int($d->rev) || !isset($d->data) || !is_object($d->data) || !isset($d->data->items) || !is_array($d->data->items)) {
        fail(400, 'Bad request.');
    }
    $json = json_encode($d->data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen($json) > $MAX_DOC) { fail(413, 'Your data is too large to save.'); }
    $rev = write_tx(function ($pdo) use ($uid, $d, $json) {
        $s = $pdo->prepare('SELECT rev FROM docs WHERE user_id=?'); $s->execute(array($uid));
        $cur = $s->fetchColumn(); $cur = $cur === false ? 0 : (int)$cur;
        if ($cur !== $d->rev) { return -$cur - 1; }   // someone saved in between (another device)
        $pdo->prepare('INSERT OR REPLACE INTO docs(user_id,data,rev,updated) VALUES(?,?,?,?)')->execute(array($uid, $json, $cur + 1, now_ms()));
        return $cur + 1;
    });
    if ($rev < 0) { fail(409, 'Your data was changed on another device.', array('rev' => -$rev - 1)); }
    jout(200, array('rev' => $rev));
}

// ------------------------------------------------------------------ backup
// A single consistent copy of the database, including changes still waiting in the -wal file.
function send_backup() {
    $tmp = data_dir() . '/backup-' . bin2hex(random_bytes(6)) . '.db';
    try {
        try { q('VACUUM INTO ?', array($tmp)); }
        catch (Exception $e) {
            // SQLite older than 3.27 (AlmaLinux 8): copy every table inside one read transaction
            @unlink($tmp);
            $pdo = db();
            $pdo->prepare('ATTACH DATABASE ? AS b')->execute(array($tmp));
            try {
                $pdo->exec('BEGIN');
                try {
                    $schema = $pdo->query("SELECT type,name,sql FROM main.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='table' DESC")->fetchAll();
                    foreach ($schema as $s) {
                        $pdo->exec(preg_replace('/^CREATE (TABLE|UNIQUE INDEX|INDEX) /i', 'CREATE $1 b.', $s['sql']));
                        if ($s['type'] === 'table') { $pdo->exec('INSERT INTO b."' . $s['name'] . '" SELECT * FROM main."' . $s['name'] . '"'); }
                    }
                    $pdo->exec('PRAGMA b.user_version=' . (int)$pdo->query('PRAGMA user_version')->fetchColumn());
                    $pdo->exec('COMMIT');
                } catch (Exception $e2) { $pdo->exec('ROLLBACK'); throw $e2; }
            } finally { $pdo->exec('DETACH DATABASE b'); }
        }
        $size = filesize($tmp);
        if (!$size) { throw new Exception('backup file is empty'); }
        http_response_code(200);
        header('Content-Type: application/vnd.sqlite3');
        header('Content-Disposition: attachment; filename="cent-aur-' . date('Y-m-d') . '.db"');
        header('Content-Length: ' . $size);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($tmp);
    } finally { @unlink($tmp); }
    exit;
}

// ------------------------------------------------------------------ admin
function admins_left($pdo, $exclude) {
    $s = $pdo->prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id<>?"); $s->execute(array($exclude));
    return (int)$s->fetch()['n'];
}
function admin_api($method, $path, $me) {
    if ($path === 'admin/users' && $method === 'GET') {
        $rows = q("SELECT u.id,u.username,u.role,u.active,u.created,
            (SELECT updated FROM docs d WHERE d.user_id=u.id) AS saved,
            (SELECT MAX(seen) FROM sessions s WHERE s.user_id=u.id) AS seen,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) AS sessions FROM users u ORDER BY u.username COLLATE NOCASE")->fetchAll();
        foreach ($rows as &$r) {
            foreach (array('id', 'active', 'created', 'sessions') as $k) { $r[$k] = (int)$r[$k]; }
            foreach (array('saved', 'seen') as $k) { $r[$k] = $r[$k] === null ? null : (int)$r[$k]; }
        }
        jout(200, array('users' => $rows, 'me' => (int)$me['id']));
    }
    if ($path === 'admin/backup' && $method === 'GET') { send_backup(); }
    if ($path === 'admin/users' && $method === 'POST') {
        $d = body_json();
        $name = trim(str_field($d, 'username')); $pw = str_field($d, 'password');
        if (!user_ok($name)) { fail(400, 'The user name must be 2-40 letters, numbers or . _ - @'); }
        $p = pw_problem($pw); if ($p) { fail(400, $p); }
        $h = pw_hash($pw);
        $id = write_tx(function ($pdo) use ($name, $h) {
            $e = $pdo->prepare('SELECT 1 FROM users WHERE username=?'); $e->execute(array($name));
            if ($e->fetch()) { throw new RuntimeException('That user name is already taken.'); }
            $pdo->prepare("INSERT INTO users(username,pass,role,active,must_change,created) VALUES(?,?,'user',1,0,?)")->execute(array($name, $h, now_ms()));
            return (int)$pdo->lastInsertId();
        });
        jout(200, array('ok' => true, 'id' => $id));
    }
    if (!preg_match('#^admin/users/(\d+)(/logout)?$#', $path, $m)) { fail(404, 'Not found.'); }
    $tid = (int)$m[1];
    $target = q1('SELECT * FROM users WHERE id=?', array($tid));
    if (!$target) { fail(404, 'No such user.'); }
    if (!empty($m[2]) && $method === 'POST') { q('DELETE FROM sessions WHERE user_id=?', array($tid)); jout(200, array('ok' => true)); }
    if ($method === 'PATCH') {
        $d = body_json();
        write_tx(function ($pdo) use ($d, $tid, $target) {
            if (isset($d['username'])) {
                $nm = trim((string)$d['username']);
                if (!user_ok($nm)) { throw new RuntimeException('The user name must be 2-40 letters, numbers or . _ - @'); }
                $s = $pdo->prepare('SELECT 1 FROM users WHERE username=? AND id<>?'); $s->execute(array($nm, $tid));
                if ($s->fetch()) { throw new RuntimeException('That user name is already taken.'); }
                $pdo->prepare('UPDATE users SET username=? WHERE id=?')->execute(array($nm, $tid));
            }
            if (isset($d['password']) && $d['password'] !== '') {
                $p = pw_problem($d['password']); if ($p) { throw new RuntimeException($p); }
                $pdo->prepare('UPDATE users SET pass=? WHERE id=?')->execute(array(pw_hash($d['password']), $tid));
                $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute(array($tid));
            }
            if (isset($d['role'])) {
                $role = $d['role'] === 'admin' ? 'admin' : 'user';
                if ($role !== 'admin' && $target['role'] === 'admin' && admins_left($pdo, $tid) === 0) { throw new RuntimeException('There must always be one active administrator.'); }
                $pdo->prepare('UPDATE users SET role=? WHERE id=?')->execute(array($role, $tid));
            }
            if (array_key_exists('active', $d)) {
                $act = $d['active'] ? 1 : 0;
                if (!$act && $target['role'] === 'admin' && admins_left($pdo, $tid) === 0) { throw new RuntimeException('There must always be one active administrator.'); }
                $pdo->prepare('UPDATE users SET active=? WHERE id=?')->execute(array($act, $tid));
                if (!$act) { $pdo->prepare('DELETE FROM sessions WHERE user_id=?')->execute(array($tid)); }
            }
        });
        jout(200, array('ok' => true));
    }
    if ($method === 'DELETE') {
        if ($tid === (int)$me['id']) { fail(400, "You can't delete your own account while signed in."); }
        write_tx(function ($pdo) use ($tid, $target) {
            if ($target['role'] === 'admin' && admins_left($pdo, $tid) === 0) { throw new RuntimeException('There must always be one active administrator.'); }
            $pdo->prepare('DELETE FROM users WHERE id=?')->execute(array($tid));
        });
        jout(200, array('ok' => true));
    }
    fail(405, 'Not allowed.');
}

// ------------------------------------------------------------------ the request
$method = $_SERVER['REQUEST_METHOD'];
$uri = parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/', PHP_URL_PATH);
if (!preg_match('#/api/(.*)$#', (string)$uri, $pm)) { http_response_code(404); exit; }
$path = trim(urldecode($pm[1]), '/');

// Changes must come from this site's own page: other sites cannot send this header without the browser asking first.
if ($method !== 'GET') {
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
    $o = isset($_SERVER['HTTP_ORIGIN']) ? rtrim($_SERVER['HTTP_ORIGIN'], '/') : '';
    if ($o !== '' && $o !== 'https://' . $host && $o !== 'http://' . $host) { fail(403, 'Blocked: wrong origin.'); }
    if (!isset($_SERVER['HTTP_X_REQUESTED_WITH']) || $_SERVER['HTTP_X_REQUESTED_WITH'] !== 'CentAur') { fail(403, 'Blocked: missing header.'); }
}

try {
    db();
    process_reset_file();
    $ip = client_ip();
    $tok = isset($_COOKIE['ca_session']) ? (string)$_COOKIE['ca_session'] : '';

    if ($path === 'health') { jout(200, array('ok' => true, 'version' => $VERSION)); }
    if ($path === 'session' && $method === 'GET') {
        $u = user_for($tok);
        // ?data=1: the page's first request also brings the data, so the page does not wait for a second one
        if ($u && !$u['must_change'] && isset($_GET['data'])) { raw_out('{"user":' . json_encode(pub($u), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ',' . data_json((int)$u['id']) . '}'); }
        jout(200, array('user' => $u ? pub($u) : null));
    }
    if ($path === 'login' && $method === 'POST') {
        $d = body_json();
        do_login(trim(str_field($d, 'username')), str_field($d, 'password'), $ip);
    }
    $u = user_for($tok);
    if (!$u) { fail(401, 'Please sign in.'); }
    $uid = (int)$u['id'];
    if ($path === 'logout' && $method === 'POST') { q('DELETE FROM sessions WHERE hash=?', array(hash('sha256', $tok))); jout(200, array('ok' => true), ''); }
    if ($path === 'password' && $method === 'POST') {
        $d = body_json();
        // the first sign-in with the default password goes straight to choosing a new one
        if (!$u['must_change'] && !pw_check(str_field($d, 'old'), $u['pass'])) { fail(403, 'The current password is not right.'); }
        $new = str_field($d, 'new');
        $p = pw_problem($new); if ($p) { fail(400, $p); }
        $h = pw_hash($new); $keep = hash('sha256', $tok);
        write_tx(function ($pdo) use ($h, $uid, $keep) {
            $pdo->prepare('UPDATE users SET pass=?, must_change=0 WHERE id=?')->execute(array($h, $uid));
            $pdo->prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?')->execute(array($uid, $keep));
        });
        jout(200, array('ok' => true));
    }
    if ($u['must_change']) { fail(403, 'Please choose a new password first.', array('must_change' => true)); }
    if ($path === 'data' && $method === 'GET') { get_data($uid); }
    if ($path === 'data' && $method === 'PUT') { put_data($uid); }
    if (strncmp($path, 'admin/', 6) === 0) {
        if ($u['role'] !== 'admin') { fail(403, 'Only the administrator can do that.'); }
        admin_api($method, $path, $u);
    }
    fail(404, 'Not found.');
} catch (RuntimeException $e) {
    fail(400, $e->getMessage());
} catch (Exception $e) {
    error_log('Cent-aur: ' . $e->getMessage());
    fail(500, 'Something went wrong on the server.');
}
