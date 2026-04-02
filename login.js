import { login } from "./auth.js";

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const errorMsg = document.getElementById("error-msg");

async function handleLogin() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    errorMsg.innerText = "メールアドレスとパスワードを入力してください。";
    errorMsg.style.display = "block";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.innerText = "ログイン中...";
  errorMsg.style.display = "none";

  const result = await login(email, password);

  if (result.success) {
    // Redirect to main page after successful login
    window.location.href = "/index.html";
  } else {
    // Show error message
    errorMsg.innerText = "ログインに失敗しました。詳細: " + result.error;
    errorMsg.style.display = "block";
    loginBtn.disabled = false;
    loginBtn.innerText = "ログイン";
  }
}

loginBtn.addEventListener("click", handleLogin);

// Add Enter key support
passwordInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleLogin();
});
