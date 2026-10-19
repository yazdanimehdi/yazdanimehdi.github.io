<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ adminPath: string; siteName: string; password: boolean; github: boolean; error: string }>();
const username = ref('');
const pass = ref('');
const message = ref(props.error);
const busy = ref(false);

/** Not the shared api(): it reloads the page on 401, which here just means "wrong password". */
async function submit() {
  busy.value = true;
  message.value = '';
  try {
    const res = await fetch('/api/admin/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: pass.value }),
    });
    if (res.ok) {
      location.href = `/${props.adminPath}`;
      return;
    }
    message.value =
      ((await res.json().catch(() => null)) as { error?: string } | null)?.error || `Sign-in failed (${res.status})`;
  } catch {
    message.value = 'Could not reach the site. Try again.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="adm-login">
    <h1>{{ siteName }}</h1>
    <p class="adm-muted">Site admin</p>
    <form v-if="password" class="adm-form" @submit.prevent="submit">
      <label class="adm-field">
        <span>Username</span>
        <input v-model="username" type="text" autocomplete="username" autocapitalize="none" required />
      </label>
      <label class="adm-field">
        <span>Password</span>
        <input v-model="pass" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit" class="adm-btn adm-btn-primary" :disabled="busy">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <a v-if="github" class="adm-btn" :class="{ 'adm-btn-primary': !password }" href="/api/admin/auth/login">
      Sign in with GitHub
    </a>
    <p v-if="message" class="adm-error" role="alert">{{ message }}</p>
  </main>
</template>
