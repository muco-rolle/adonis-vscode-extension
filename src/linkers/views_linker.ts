import { join } from 'path'
import fg from 'fast-glob'
import slash from 'slash'
import { edgeComponentsAsTagsRegex, edgeRegex, tsRegex } from '../utilities/regexes'
import { EdgeComponentsFinder } from '../edge_components_finder'
import type { AdonisProject } from '../adonis_project'

export interface ViewLink {
  templatePath: string
  position: {
    line: number
    colStart: number
    colEnd: number
  }
}

/**
 * Purpose of this class is :
 * - Scan a .edge or .ts file for linked templates with some regexes
 * - If a linked template is found, search the related file in the project
 * - And return a Link, that will be used to create DocumentLink in the editor
 */
export class ViewsLinker {
  static #matchIndexToPosition(options: { fileContent: string; match: RegExpMatchArray }) {
    const lines = options.fileContent.split('\n')

    const line = lines.findIndex((line) => line.includes(options.match[1]!))
    const colStart = lines[line]!.indexOf(options.match[1]!)
    const colEnd = colStart + options.match[1]!.length

    return { line, colStart, colEnd }
  }

  /**
   * Get all links from a .edge or .ts file.
   * i.e. ones from @include or @layout tags or from view.render() calls
   */
  static async #getBasicLinks(options: {
    fileContent: string
    sourceType: 'edge' | 'ts'
    project: AdonisProject
  }): Promise<ViewLink[]> {
    const regex = options.sourceType === 'edge' ? edgeRegex : tsRegex
    const matches = options.fileContent.matchAll(regex) || []

    const matchesArray = Array.from(matches)

    const promises = matchesArray.map(async (match) => {
      const fileName = match[1]!.replace(/\"|\'/g, '').replace(/\./g, '/')
      const pattern = slash(`resources/views/${fileName}.edge`)

      const edgeFiles = await fg(pattern, {
        onlyFiles: true,
        caseSensitiveMatch: false,
        cwd: slash(options.project.path),
      })

      if (!edgeFiles.length) {
        return
      }

      const position = ViewsLinker.#matchIndexToPosition({
        fileContent: options.fileContent,
        match,
      })

      return {
        templatePath: join(options.project.path, edgeFiles[0]!),
        position,
      }
    })

    const result = await Promise.all(promises)
    return result.filter(Boolean) as ViewLink[]
  }

  /**
   * Get all links from components used as tags in a .edge file
   */
  static async #getComponentAsTagsLinks(options: {
    fileContent: string
    project: AdonisProject
  }): Promise<ViewLink[]> {
    const matches = options.fileContent.matchAll(edgeComponentsAsTagsRegex) || []

    const matchesArray = Array.from(matches)
    if (!matchesArray.length) {
      return []
    }

    const components = await EdgeComponentsFinder.find(options.project)
    return matchesArray
      .map((match) => {
        const component = components.find((component) => component.name === match[1]!)

        if (!component) return

        const position = ViewsLinker.#matchIndexToPosition({
          fileContent: options.fileContent,
          match,
        })

        return { templatePath: component.path, position }
      })
      .filter(Boolean) as ViewLink[]
  }

  /**
   * Get all the links from a .edge file
   */
  public static async getLinks(options: {
    fileContent: string
    sourceType: 'edge' | 'ts'
    project: AdonisProject
  }): Promise<ViewLink[]> {
    const basicLinksPromise = this.#getBasicLinks(options)
    const componentsAsTagsPromise = this.#getComponentAsTagsLinks(options)

    const results = await Promise.all([basicLinksPromise, componentsAsTagsPromise])
    return results.flat()
  }
}
