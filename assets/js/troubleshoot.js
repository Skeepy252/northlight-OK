/* Click-through decision tree. Each node is either a question (yes/no) or a result. */
(function () {
  'use strict';
  const { h, $, mount } = NL;
  const LADDER = ['Network connection', 'IP address', 'Router', 'External connectivity', 'DNS'];
  const TREE = {
    link: { step: 0, q: 'Is the device connected to a network (Wi-Fi connected or cable plugged in)?', how: 'Look at the Wi-Fi/network icon. Is airplane mode off?',
      yes: 'ip', no: { cause: 'No network connection', action: 'Turn Wi-Fi on / airplane mode off, reconnect to the network or replug the cable, and check the cable and adapter.' } },
    ip: { step: 1, q: 'Does the device have a valid IP address (not empty and not starting with 169.254)?', how: 'Windows: run ipconfig. macOS/Linux: run ifconfig or ip addr.',
      yes: 'router', no: { cause: 'No valid IP address (DHCP problem)', action: 'Renew the lease (Windows: ipconfig /release then /renew), reconnect, or restart the router that hands out addresses.' } },
    router: { step: 2, q: 'Can you reach the router (ping the default gateway, or open its admin page)?', how: 'Find the gateway in ipconfig / ip route and run: ping <gateway>.',
      yes: 'external', no: { cause: 'Router or local link problem', action: 'Check the Wi-Fi signal and cabling, restart the router, and try another device to see if the problem is wider than this computer.' } },
    external: { step: 3, q: 'Can you reach an external IP address (ping 1.1.1.1)?', how: 'Run: ping 1.1.1.1. This tests the internet without involving DNS.',
      yes: 'dns', no: { cause: 'Internet (WAN/ISP) outage', action: 'The router works but the internet does not. Restart the modem/router, check the provider status page and contact the ISP if it persists.' } },
    dns: { step: 4, q: 'Can you resolve a website name (ping example.com or nslookup example.com)?', how: 'Run: nslookup example.com. Compare with ping 1.1.1.1 working.',
      yes: { cause: 'Network ladder is healthy', action: 'Basic connectivity and DNS work. The problem is probably the specific website, browser, proxy/VPN or firewall. Try another site or browser and disable VPN to test.' },
      no: { cause: 'DNS problem', action: 'IP connectivity works but names do not resolve. Restart the router, flush the DNS cache (ipconfig /flushdns) or set another DNS server such as 1.1.1.1.' } }
  };
  let path = ['link'];
  let result = null;

  function render() {
    const cur = result ? 5 : TREE[path[path.length - 1]].step;
    mount($('#ladder'), LADDER.map((l, i) => {
      const upto = result ? (result.ok ? LADDER.length : result.failStep) : cur; // steps after a failure are not tested yet
      const failed = !!result && !result.ok && result.failStep === i, passed = i < upto;
      return h('li', { class: failed ? 'current' : passed ? 'done' : i === cur && !result ? 'current' : null, 'data-state': failed ? 'fail' : passed ? 'pass' : 'pending' },
        l, h('span', { class: 'ladder-state' }, failed ? '✗ FAIL' : passed ? '✓ PASS' : ''));
    }));
    if (result) {
      mount($('#step-card'), h('div', { class: 'result card', id: 'result' },
        h('span', { class: 'eyebrow' }, result.ok ? 'All good' : 'Likely cause'), h('h2', null, result.cause), h('p', null, h('strong', null, 'Recommended next action: '), result.action),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', id: 'back', onclick: back }, 'Back'), h('button', { class: 'btn', type: 'button', id: 'restart', onclick: restart }, 'Start again'))));
      return;
    }
    const n = TREE[path[path.length - 1]];
    mount($('#step-card'), h('h2', { id: 'question' }, 'Step ' + (n.step + 1) + ' of 5: ' + LADDER[n.step]), h('p', null, n.q), h('p', { class: 'hint' }, 'How to check: ' + n.how),
      h('div', { class: 'answers' }, h('button', { class: 'btn', type: 'button', id: 'yes', onclick: () => answer('yes') }, 'Yes'), h('button', { class: 'btn ghost', type: 'button', id: 'no', onclick: () => answer('no') }, 'No'),
        path.length > 1 ? h('button', { class: 'btn ghost', type: 'button', id: 'back', onclick: back }, 'Back') : null));
  }
  function answer(a) {
    const key = path[path.length - 1], n = TREE[key], next = n[a];
    if (typeof next === 'string') path.push(next);
    else result = Object.assign({ ok: a === 'yes', failStep: a === 'no' ? n.step : null }, next);
    render();
  }
  function back() { if (result) result = null; else if (path.length > 1) path.pop(); render(); }
  function restart() { path = ['link']; result = null; render(); }
  render();
})();
