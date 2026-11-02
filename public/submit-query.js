import { officialTrackingLink } from './carriers.js';

const status = document.querySelector('#submit-status');
try {
  const params = new URLSearchParams(location.search);
  const carrier = params.get('carrier');
  const number = params.get('number');
  const destination = officialTrackingLink(carrier, number);
  if (carrier !== 'tongzhi' || destination.method !== 'POST') throw new Error('不支持的官网查询方式');
  const form = document.querySelector('#official-form');
  form.method = 'POST'; form.action = destination.url; form.target = '_self';
  for (const [name, value] of Object.entries(destination.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
  }
  form.hidden = false;
  status.textContent = '正在向同智官网提交单号，无需再次输入。若浏览器拦截自动提交，请点击下方按钮。';
  form.requestSubmit();
} catch (error) { status.textContent = error.message; }
