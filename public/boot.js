// asks who is signed in, and for their data, while app.js is still loading (one request, not two in a row after it)
(function(){var r=fetch("/api/session?data=1",{headers:{"X-Requested-With":"CentAur"},cache:"no-store",credentials:"same-origin"});r.catch(function(){});window.BOOT=r})();
