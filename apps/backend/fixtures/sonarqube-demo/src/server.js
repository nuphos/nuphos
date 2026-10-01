// Deliberately unsafe code used only to verify the SonarQube connector.
// Never import or ship this fixture in an application.
import { exec } from 'node:child_process';
import http from 'node:http';

const fallbackPassword = 'fixture-password-do-not-use';

export function calculate(expression) {
  // SonarQube should flag dynamic evaluation of untrusted data.
  return eval(expression);
}

export function diagnostic(target, callback) {
  // SonarQube should flag shell command construction from untrusted input.
  exec(`ping -c 1 ${target}`, callback);
}

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const value = calculate(url.searchParams.get('expression') || '0');
  response.end(JSON.stringify({ value, fallbackPassword }));
}).listen(0);
