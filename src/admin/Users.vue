<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from './AdminShell.vue';
import { api, report, toast } from './api';
import type { AdminCtx } from './types';

interface Account {
  username: string;
  name: string;
  created_at: string;
}
defineProps<{ ctx: AdminCtx }>();
const accounts = ref<Account[]>([]);
const githubAdmins = ref<string[]>([]);
const adding = ref({ username: '', name: '', password: '' });
const resetting = ref<{ username: string; password: string } | null>(null);
const confirmDelete = ref('');
const own = ref({ current: '', next: '', again: '' });

async function load() {
  try {
    const data = await api<{ accounts: Account[]; githubAdmins: string[] }>('users');
    accounts.value = data.accounts;
    githubAdmins.value = data.githubAdmins;
  } catch (e) {
    report(e);
  }
}

async function add() {
  try {
    await api('users', { body: adding.value });
    toast(`Added ${adding.value.username}`);
    adding.value = { username: '', name: '', password: '' };
    await load();
  } catch (e) {
    report(e);
  }
}

async function reset() {
  if (!resetting.value) return;
  try {
    await api(`users/${encodeURIComponent(resetting.value.username)}`, {
      method: 'PUT',
      body: { password: resetting.value.password },
    });
    toast(`Password reset; ${resetting.value.username} is signed out everywhere`);
    resetting.value = null;
  } catch (e) {
    report(e);
  }
}

async function remove(username: string) {
  try {
    await api(`users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    toast(`Deleted ${username}`);
    confirmDelete.value = '';
    await load();
  } catch (e) {
    report(e);
  }
}

async function changeOwn() {
  if (own.value.next !== own.value.again) return toast('The new passwords don’t match');
  try {
    await api('account/password', { body: { current: own.value.current, next: own.value.next } });
    toast('Password changed; your other devices are signed out');
    own.value = { current: '', next: '', again: '' };
  } catch (e) {
    report(e);
  }
}

onMounted(load);
</script>

<template>
  <AdminShell :ctx="ctx" active="users" title="Users">
    <section class="adm-form" aria-labelledby="adm-accounts">
      <h2 id="adm-accounts" class="adm-h2">Accounts</h2>
      <table class="adm-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Created</th>
            <th><span class="adm-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.username">
            <td>{{ a.username }}</td>
            <td>{{ a.name }}</td>
            <td>{{ new Date(a.created_at).toLocaleDateString() }}</td>
            <td class="adm-actions">
              <template v-if="resetting?.username === a.username">
                <input
                  v-model="resetting.password"
                  type="password"
                  autocomplete="new-password"
                  :aria-label="`New password for ${a.username}`"
                  placeholder="New password (12+ characters)"
                />
                <button type="button" class="adm-btn adm-btn-small adm-btn-primary" @click="reset">Save</button>
                <button type="button" class="adm-btn adm-btn-small" @click="resetting = null">Cancel</button>
              </template>
              <template v-else-if="confirmDelete === a.username">
                <span>Delete {{ a.username }}?</span>
                <button type="button" class="adm-btn adm-btn-small" @click="remove(a.username)">Delete</button>
                <button type="button" class="adm-btn adm-btn-small" @click="confirmDelete = ''">Cancel</button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="adm-btn adm-btn-small"
                  @click="resetting = { username: a.username, password: '' }"
                >
                  Reset password
                </button>
                <button type="button" class="adm-btn adm-btn-small" @click="confirmDelete = a.username">Delete</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="githubAdmins.length" class="adm-muted">
        GitHub admins (managed in config/site.yml): {{ githubAdmins.join(', ') }}
      </p>
    </section>

    <form class="adm-card adm-form" aria-labelledby="adm-add" @submit.prevent="add">
      <h2 id="adm-add" class="adm-h2">Add an account</h2>
      <label class="adm-field"
        ><span>Username</span><input v-model="adding.username" required autocapitalize="none"
      /></label>
      <label class="adm-field"><span>Display name</span><input v-model="adding.name" /></label>
      <label class="adm-field">
        <span>Initial password</span>
        <input v-model="adding.password" type="password" autocomplete="new-password" required />
        <small>At least 12 characters. They can change it after signing in.</small>
      </label>
      <div class="adm-actions"><button type="submit" class="adm-btn adm-btn-primary">Add account</button></div>
    </form>

    <form
      v-if="ctx.user?.provider === 'password'"
      class="adm-card adm-form"
      aria-labelledby="adm-own"
      @submit.prevent="changeOwn"
    >
      <h2 id="adm-own" class="adm-h2">Change your password</h2>
      <label class="adm-field">
        <span>Current password</span>
        <input v-model="own.current" type="password" autocomplete="current-password" required />
      </label>
      <label class="adm-field">
        <span>New password</span>
        <input v-model="own.next" type="password" autocomplete="new-password" required />
      </label>
      <label class="adm-field">
        <span>New password again</span>
        <input v-model="own.again" type="password" autocomplete="new-password" required />
      </label>
      <div class="adm-actions"><button type="submit" class="adm-btn adm-btn-primary">Change password</button></div>
    </form>
  </AdminShell>
</template>
