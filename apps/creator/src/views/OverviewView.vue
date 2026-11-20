<script setup>
import { computed, nextTick, ref } from 'vue'
import { useProjectStore } from '../stores/project.js'
import { formatDateTime, formatRelativeTime } from '../utils/time.js'
import { useAssetUrls } from '../composables/use-asset-urls.js'
import AppIcon from '../components/ui/AppIcon.vue'
import { overviewSummary } from './overview-summary.js'

const editor = useProjectStore()
const project = computed(() => editor.project)
const summary = computed(() => overviewSummary(project.value || {}))
const owner = computed(() => project.value?.characters?.find(character => character.id === project.value.workSettings?.ownerCharacterId))
const characters = computed(() => [...(project.value?.characters || [])].sort((a, b) => Number(b.id === owner.value?.id) - Number(a.id === owner.value?.id)).slice(0, 4))
const { urls } = useAssetUrls(editor, () => characters.value.map(character => character.avatarAssetId))
const storyMonth = computed(() => {
  const match = /^(\d{4})-(\d{2})/.exec(project.value?.workSettings?.storyDate || '')
  return match ? `${match[1]}年${Number(match[2])}月` : ''
})
const toApp = row => ({ name: 'apps', params: { projectId: project.value.id, app: row.id }, ...(row.recordId ? { query: { record: row.recordId } } : {}) })
const toCharacters = computed(() => ({ name: 'characters', params: { projectId: project.value?.id } }))
const dialog = ref(null)
const editButton = ref(null)
const draftName = ref('')
const draftDescription = ref('')
const nameInput = ref(null)
async function openInfo() {
  draftName.value = project.value.name
  draftDescription.value = project.value.projectDescription || ''
  dialog.value.showModal()
  await nextTick()
  nameInput.value?.focus()
}
function closeInfo() { dialog.value.close(); editButton.value?.focus() }
function saveInfo() {
  if (editor.isReadOnly) return
  editor.patch({ name: draftName.value.trim() || '未命名作品', projectDescription: draftDescription.value })
  closeInfo()
}
</script>

<template>
  <article v-if="project" class="work-home" data-testid="work-home">
    <header class="work-home__hero">
      <div class="work-home__identity">
        <p class="work-home__eyebrow">{{ owner ? owner.name + '的手机' : '尚未指定手机主人' }}<template v-if="storyMonth"> · {{ storyMonth }}</template></p>
        <h1>{{ project.name || '未命名作品' }}</h1>
        <p class="work-home__description" :class="{ 'is-empty': !project.projectDescription }">{{ project.projectDescription || '在作品信息中，记下这个故事的开始。' }}</p>
      </div>
      <button ref="editButton" type="button" class="work-home__edit" data-testid="work-info-edit" @click="openInfo">{{ editor.isReadOnly ? '查看作品信息' : '编辑作品信息' }}</button>
    </header>

    <section class="work-home__resume" aria-labelledby="work-resume-title">
      <div class="work-home__resume-head"><h2 id="work-resume-title">继续创作</h2><RouterLink v-if="summary.recent" :to="toApp(summary.recent)" class="work-home__resume-action">继续编辑</RouterLink><RouterLink v-else :to="toApp({ id: 'messages' })" class="work-home__resume-action">开始写对话</RouterLink></div>
      <RouterLink v-if="summary.recent" :to="toApp(summary.recent)" class="work-home__resume-link" data-testid="work-resume">
        <div class="work-home__resume-copy">
          <p class="work-home__location">{{ summary.recent.name }}<template v-if="summary.recent.preview"> / {{ summary.recent.preview }}</template></p>
          <p class="work-home__excerpt">{{ summary.recent.excerpt || '接着写下这个故事。' }}</p>
          <p v-if="summary.recent.modifiedAt" class="work-home__edited" :title="formatDateTime(summary.recent.modifiedAt)">上次编辑于 {{ formatRelativeTime(summary.recent.modifiedAt) }}</p>
        </div>
      </RouterLink>
      <div v-else class="work-home__start"><p>故事还没有内容，从一段对话开始。</p></div>
    </section>

    <div class="work-home__columns">
      <section class="work-home__people" aria-labelledby="work-people-title">
        <div class="work-home__section-head"><h2 id="work-people-title">人物</h2><RouterLink :to="toCharacters">查看全部</RouterLink></div>
        <ul v-if="characters.length" class="work-home__people-list">
          <li v-for="character in characters" :key="character.id">
            <RouterLink :to="toCharacters" class="work-home__person">
              <span class="work-home__avatar"><img v-if="urls.get(character.avatarAssetId)" :src="urls.get(character.avatarAssetId)" alt="" /><span v-else>{{ character.name?.[0] || '人' }}</span></span>
              <span class="work-home__person-copy"><strong>{{ character.name || '未命名人物' }}</strong><span>{{ character.id === owner?.id ? '手机主人' : character.description || '还没有人物介绍' }}</span></span>
            </RouterLink>
          </li>
        </ul>
        <div v-else class="work-home__empty work-home__people-empty"><p>还没有人物。<RouterLink :to="toCharacters">添加第一个人物</RouterLink></p></div>
      </section>

      <section class="work-home__directory" aria-labelledby="work-directory-title">
        <h2 id="work-directory-title">内容目录</h2>
        <ul><li v-for="row in summary.rows" :key="row.id"><RouterLink :to="toApp(row)" class="work-home__content-row" :data-app="row.id"><AppIcon :name="row.id" /><span class="work-home__app-name">{{ row.name }}</span><span class="work-home__content-preview">{{ row.preview }}</span><span class="work-home__count">{{ row.countLabel }}</span><span aria-hidden="true" class="work-home__chevron">›</span></RouterLink></li></ul>
      </section>
    </div>

    <footer class="work-home__footer"><span :title="formatDateTime(project.createdAt)">创建于 {{ formatDateTime(project.createdAt).split(' ')[0] }}</span><span :title="formatDateTime(project.updatedAt)">修改于 {{ formatRelativeTime(project.updatedAt) }}</span></footer>

    <dialog ref="dialog" class="work-info" aria-labelledby="work-info-title" @click.self="closeInfo" @cancel.prevent="closeInfo">
      <form @submit.prevent="saveInfo">
        <header><h2 id="work-info-title">作品信息</h2><button type="button" aria-label="关闭作品信息" @click="closeInfo">×</button></header>
        <label for="project-name">作品名称</label><input id="project-name" ref="nameInput" v-model="draftName" maxlength="80" :disabled="editor.isReadOnly" required />
        <label for="project-desc">作品说明 <span>仅创作端可见</span></label><textarea id="project-desc" v-model="draftDescription" rows="4" maxlength="500" :disabled="editor.isReadOnly" placeholder="记下故事设定或创作线索"></textarea><small>{{ draftDescription.length }} / 500</small>
        <footer><button type="button" @click="closeInfo">{{ editor.isReadOnly ? '关闭' : '取消' }}</button><button v-if="!editor.isReadOnly" type="submit" class="work-info__save">保存</button></footer>
      </form>
    </dialog>
  </article>
</template>

<style scoped>
.work-home{--home-muted:#656864;--home-line:#eceeeb;--home-accent:#9b5140;container-type:inline-size;container-name:work-home;max-width:1280px;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,64px));margin:0 auto;padding:36px 48px 24px;background:#fff;display:flex;flex-direction:column;color:var(--c-text)}
:global(.ws__main:has(.work-home)){background:#fff}
.work-home__hero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:0 24px;padding-bottom:28px;border-bottom:1px solid var(--home-line)}
.work-home__identity{display:contents}.work-home__eyebrow{grid-row:1;grid-column:1;font-size:12px;line-height:1.7;margin:0}
.work-home h1{grid-row:2;grid-column:1/-1;min-width:0;max-width:100%;margin-top:8px;font:600 34px/1.4 var(--font-story,'Work Serif','Songti SC',SimSun,serif);letter-spacing:.02em;overflow-wrap:anywhere}
.work-home__description{grid-row:3;grid-column:1/-1;font-size:14px;line-height:1.8;margin-top:6px;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}.is-empty{color:var(--home-muted)}
.work-home__edit{grid-row:1;grid-column:2;justify-self:end;align-self:center;display:flex;align-items:center;background:none;border:0;padding:0;min-height:24px;font-size:12px;color:var(--home-muted);white-space:nowrap}
.work-home h2{font-size:18px;line-height:1.5;font-weight:600}
.work-home__resume{padding:26px 0 28px;border-bottom:1px solid var(--home-line)}
.work-home__resume-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.work-home__resume-link{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:16px;padding-left:18px;border-left:2px solid var(--home-accent)}
.work-home__resume-copy{min-width:0}.work-home__location{font-size:12px;color:var(--home-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65ch}
.work-home__excerpt{font:600 19px/1.7 var(--font-story,'Work Serif','Songti SC',SimSun,serif);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;margin-top:4px}
.work-home__edited{font-size:12px;color:var(--home-muted);margin-top:6px}.work-home__resume-action{flex:none;font-size:13px;line-height:1.5;color:var(--home-accent)}
.work-home__columns{display:grid;grid-template-columns:minmax(210px,.8fr) minmax(0,1.8fr);gap:48px;padding-top:28px}
.work-home__section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.work-home__section-head>a{font-size:12px;color:var(--home-muted);white-space:nowrap}
.work-home ul{list-style:none;padding:0;margin:16px 0 0}.work-home__people-list{display:grid;gap:18px}.work-home__person{display:flex;align-items:flex-start;gap:14px}
.work-home__avatar{display:grid;place-items:center;width:40px;height:40px;flex:none;border-radius:50%;background:#eeedea;color:#565956;font:400 19px/1 var(--font-story,'Work Serif',SimSun,serif);overflow:hidden}.work-home__avatar img{width:100%;height:100%;object-fit:cover}
.work-home__person-copy{display:grid;gap:3px;min-width:0}.work-home__person-copy strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}.work-home__person-copy>span{font-size:12px;color:var(--home-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.work-home__directory ul{margin-top:12px}.work-home__directory li+li{border-top:1px solid var(--home-line)}
.work-home__content-row{display:grid;grid-template-columns:18px 104px minmax(0,1fr) max-content 10px;align-items:center;gap:14px;min-height:36px;font-size:13px}.work-home__content-row>svg{width:17px;height:17px}.work-home__content-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.work-home__count{font-size:12px;color:var(--home-muted);white-space:nowrap}.work-home__chevron{font-size:20px;line-height:1;color:var(--home-muted)}
.work-home__footer{display:flex;align-items:center;flex-wrap:wrap;gap:24px;margin-top:auto;padding-top:32px;font-size:12px;color:var(--home-muted)}
.work-home__footer>span:last-child{margin-left:auto;text-align:right}
.work-home__empty,.work-home__start{font-size:13px;color:var(--home-muted);line-height:1.8;margin-top:16px}.work-home__start{display:flex;justify-content:space-between;gap:20px}.work-home__start a,.work-home__empty a{color:var(--home-accent)}.work-home a:hover,.work-home__edit:hover{color:var(--home-accent)}
.work-info{width:min(460px,calc(100vw - 32px));max-height:calc(var(--creator-viewport-height,100dvh) - 40px);padding:24px;border:1px solid var(--home-line);border-radius:12px;color:var(--c-text);background:#fff;box-shadow:0 16px 60px #0002}.work-info::backdrop{background:#20232140}.work-info form{display:flex;flex-direction:column}.work-info header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.work-info header button{font-size:24px;border:0;background:none;padding:0 4px}.work-info label{font-size:13px;margin-bottom:6px}.work-info label:not(:first-of-type){margin-top:16px}.work-info label span,.work-info small{font-size:12px;color:var(--home-muted)}.work-info input,.work-info textarea{width:100%;border:1px solid #d9dcd7;border-radius:6px;padding:8px 10px;font:inherit;font-size:14px;line-height:1.6;background:#fff;color:var(--c-text)}.work-info textarea{resize:vertical}.work-info small{align-self:flex-end;margin-top:4px}.work-info footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.work-info footer button{min-height:34px;border:1px solid #d9dcd7;border-radius:6px;background:white;padding:4px 14px;font-size:13px}.work-info footer .work-info__save{background:#30322f;color:white;border-color:#30322f}
@media(min-width:1600px){.work-home{padding-top:44px}}
@media(max-width:1100px){.work-home{padding:28px 32px 24px}.work-home__columns{gap:32px;grid-template-columns:minmax(180px,.7fr) minmax(0,1.5fr)}.work-home__content-row{grid-template-columns:18px 86px minmax(0,1fr) max-content 8px;gap:10px}}
@media(max-width:767px){.work-home{padding:24px 20px;min-height:calc(var(--creator-viewport-height,100dvh) - var(--layout-topbar-h,60px))}.work-home__hero{column-gap:12px;padding-bottom:20px}.work-home h1{font-size:28px}.work-home__eyebrow{font-size:12px}.work-home__description{font-size:13px}.work-home__edit{justify-self:end;min-height:24px}.work-home h2{font-size:17px}.work-home__resume{padding:20px 0}.work-home__resume-link{gap:12px;padding-left:12px;margin-top:12px}.work-home__excerpt{font-size:17px}.work-home__resume-action{font-size:12px;gap:4px}.work-home__location{max-width:42vw}.work-home__columns{grid-template-columns:minmax(0,1fr);gap:28px;padding-top:22px}.work-home__people-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 16px}.work-home__person{gap:10px}.work-home__avatar{width:34px;height:34px;font-size:17px}.work-home__person-copy strong{font-size:13px}.work-home__content-row{grid-template-columns:17px 83px minmax(0,1fr) max-content 8px;min-height:42px;gap:8px;font-size:12px}.work-home__count{font-size:12px}.work-home__footer{padding-top:40px;gap:8px 20px}.work-home__start{flex-wrap:wrap}.work-info{padding:20px}.work-info input,.work-info textarea{font-size:16px}}
@container work-home (max-width:640px){.work-home__columns{grid-template-columns:minmax(0,1fr);gap:28px}.work-home__people-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 16px}}
@container work-home (min-width:641px){
  .work-home__people{display:flex;flex-direction:column}
  .work-home__section-head{height:27px;flex:none;align-items:center}
  .work-home .work-home__people-list{display:flex;flex-direction:column;gap:18px;margin-top:12px}
  .work-home__people-empty{display:grid;place-items:center;flex:1;text-align:center;margin-top:12px}
  .work-home__people-empty>p{transform:translateY(-12px)}
}
@media(max-width:767px){.work-home__people-empty{text-align:center}}
</style>
