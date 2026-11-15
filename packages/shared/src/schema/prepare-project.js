import { normalizeXPostState } from '../work/x-post-state.js'
import { APPS } from '../constants/apps.js'
import { migrateProject } from '../migrate/index.js'
import { validateProject } from './validate.js'
import { SchemaError } from './errors.js'

/** Shared entry for imported and persisted projects. Never mutate caller data. */
export function prepareProject(raw) {
  const check = validateProject(raw)
  if (!check.ok) throw new SchemaError(`这份文件不像是有效的项目数据：${check.errors.join(' ')}`)
  const project = migrateProject(structuredClone(raw))
  project.workSettings ??= {}
  for (const app of APPS) {
    const bucket = project.appData[app.id]
    project.appData[app.id] = bucket && typeof bucket === 'object' ? bucket : {}
    for (const key of app.collections) project.appData[app.id][key] ??= []
  }
  for (const post of project.appData.x?.posts ?? []) {
    Object.assign(post, normalizeXPostState(post))
    delete post.xPostType
    delete post.xActorCharacterId
  }
  return { project, warnings: check.warnings }
}
