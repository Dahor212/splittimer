# SplitTimer (PWA) – nasazení na GitHub Pages

Toto je statická PWA (webová aplikace), která běží na iPhonu v režimu „Přidat na plochu“ jako samostatná aplikace.
Data se ukládají lokálně v zařízení (localStorage). Má export/import JSON.

## Struktura
- index.html – obrazovky a modaly
- style.css – vzhled
- app.js – logika (tratě, checkpointy, stopky, GPX import, profil, žebříček)
- manifest.webmanifest – PWA manifest
- sw.js – Service Worker (offline)
- icons/ – ikony

## Doporučené nasazení
GitHub Pages (HTTPS) – ideální pro iOS PWA.

## Poznámka k aktualizacím
PWA cachuje soubory přes `sw.js`. Když nasadíš novou verzi, může být potřeba:
- na iPhonu otevřít web a jednou obnovit (pull-to-refresh),
- případně odstranit a znovu přidat na plochu, pokud se dlouho neprojeví změny.
