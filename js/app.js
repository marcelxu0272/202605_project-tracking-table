/**
 * app.js — Vue 实例初始化入口（先拉取 SQLite 同步状态再挂载）
 */
(function (window) {
  'use strict';

  Vue.component('app-layout', window.AppLayoutComponent);

  Vue.filter('amount', function (val) {
    return Formatters.formatAmount(val);
  });
  Vue.filter('amountShort', function (val) {
    return Formatters.formatAmountShort(val);
  });
  Vue.filter('percent', function (val, d) {
    return Formatters.formatPercent(val, d);
  });
  Vue.filter('date', function (val) {
    return Formatters.formatDate(val);
  });

  function mountVue() {
    new Vue({
      el: '#app',
      router: window.AppRouter,
      template: '<router-view></router-view>'
    });
  }

  Store.init()
    .then(mountVue)
    .catch(function (err) {
      var el = document.getElementById('app');
      if (el) {
        el.innerHTML =
          '<div style="padding:40px;font-family:system-ui,sans-serif;max-width:520px;line-height:1.6">' +
          '<h2 style="color:#b91c1c">无法加载数据</h2>' +
          '<p>' + String(err && err.message ? err.message : err) + '</p>' +
          '<p style="color:#64748b;font-size:14px">请在本机项目目录执行 <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">npm install</code> 与 <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">npm start</code>，' +
          '在浏览器打开 <strong>http://127.0.0.1:3000/</strong>（勿使用 file:// 打开 index.html）。</p>' +
          '<p style="color:#64748b;font-size:14px">将 <strong>初始数据.xlsx</strong> 放在项目根目录后重启服务，即可自动导入到 SQLite。</p>' +
          '</div>';
      }
    });

})(window);
