# Installing Cent-aur

Cent-aur is a website with one PHP file. Apache and PHP do all the work: nothing runs in the
background, nothing is installed, and nothing needs root. These steps use
[Virtualmin](https://www.virtualmin.com/), but any Apache host with PHP works the same way.

All data lives in **one SQLite file** (`cent-aur-data/cent-aur.db`), in a folder created next to the
website folder so the web cannot reach it.

The examples use `cent-aur.example.com`; use your own domain.

## Requirements

- Apache with `mod_rewrite` (and ideally `mod_headers`), with `AllowOverride All` for the site
- PHP 7.4 or newer with the `pdo_sqlite` extension
- HTTPS, so sign-ins are kept safely

## 1. Create the website

Virtualmin → **Create Virtual Server** → `cent-aur.example.com`, with PHP enabled (the default).

## 2. Check PHP

Virtualmin → your domain → **Server Configuration → PHP Options**: choose PHP 7.4 or newer.

To confirm SQLite support, put a file containing `<?php phpinfo();` in `public_html`, open it in the
browser and look for `pdo_sqlite`. Delete the file afterwards. (AlmaLinux and Rocky Linux include it.)

## 3. Upload

Upload **everything inside [`public/`](../public)** into the domain's `public_html` (File Manager, or
SFTP with the domain's own login). Keep the hidden `.htaccess` file: enable "show hidden files".

## 4. HTTPS

Virtualmin → **Server Configuration → SSL Certificate → Let's Encrypt** → request a certificate for
your domain.

**Behind Cloudflare:** use SSL/TLS mode *Full (strict)*. With the orange cloud on, copy
`config.sample.php` to `config.php` and uncomment the `ip_header` line, so the sign-in limiter sees
real visitor addresses. Cent-aur only believes that header when the request really comes from
Cloudflare's published addresses, so nobody can fake it.

## 5. First sign-in

Open `https://cent-aur.example.com` and sign in with:

| User name | Password |
|-----------|----------|
| `admin`   | `admin`  |

You must choose your own password straight away; until you do, nothing else works. Do this right
after uploading, before anyone else finds the site.

## 6. Add your family

**Your data → Account → Manage users**: add, rename, reset passwords, make someone an administrator,
disable or delete users. Everyone has their own private data.

## 7. On a phone

Open the address in Chrome or Safari → **Add to Home Screen**. It opens like an app, but it needs an
internet connection: if the server cannot be reached, a bar at the top says your latest change is not
saved yet, and it is saved as soon as the connection is back (keep the page open until then).

## Using it on two devices at once

Changes made on another device show up within 30 seconds, or as soon as you switch back to the tab.
If both devices change something at the same moment, the second one is told, gets the latest data,
and that one change has to be made again. Nothing else is lost.

## Backups

Virtualmin's normal backup of the domain already includes `cent-aur-data` (turn on scheduled backups
for the domain). Always keep the **whole folder**: recent changes can sit in `cent-aur.db-wal` next to
`cent-aur.db`, so the `.db` file on its own may be missing them.

The easiest single-file copy is **Manage users → Download backup**. It holds everyone's data and
password hashes, so keep it somewhere safe. To restore it: rename it to `cent-aur.db`, delete
`cent-aur.db-wal` and `cent-aur.db-shm` from `cent-aur-data`, and put it in their place.

Each person can also use **Export backup** for a copy of their own data as a `.json` file.

## Forgot the administrator password

In File Manager create the file `cent-aur-data/reset-admin.txt` containing:

```
adminname:newpassword
```

Open any page of the site once: the file is read and deleted, and that user becomes an administrator
with the new password.

## Updating

Upload the new files over the old ones. Everyone gets the new version the next time they open or
reload the page. **Do not delete `cent-aur-data`.**

## Optional settings

Copy `config.sample.php` to `config.php` (it is never served to visitors) to set:

| Setting           | What it does |
|-------------------|--------------|
| `ip_header`       | Header with the visitor's real address behind a proxy, e.g. `HTTP_CF_CONNECTING_IP` |
| `trusted_proxies` | Addresses allowed to set that header (default: Cloudflare's published ranges) |
| `data_dir`        | Where the database lives (default: `cent-aur-data` next to the website folder) |
| `session_days`    | How long a sign-in lasts without being used (default: 90) |

## Troubleshooting

- **Sign-in says "Not found" for `/api/...`:** Apache is ignoring `.htaccess`. `AllowOverride` must be
  `All` for `public_html` (Virtualmin → Server Configuration → Website Options; it is the default).
- **"The cent-aur-data folder is from the older version":** a data folder from an earlier, offline
  version of Cent-aur is still there. Delete that folder and open the site again.
- **Icons:** they live in `app-icons/`, not `icons/`, because Apache reserves the address `/icons/` for
  its own pictures, so files placed there never load.
- **Buttons missing:** ad blockers hide elements whose names look like adverts (for example `adtop`).
  Cent-aur avoids such names and its tests check for them; keep it that way when changing the page.
