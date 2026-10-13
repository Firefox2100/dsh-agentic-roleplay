/** A world the package ships, which can be added to the person's worlds. */
export interface StarterWorld {
  /** The name of its folder, both in the package and once added. */
  folder: string
  name: string
  description: string
  tags: string[]
  /** Whether the person's worlds already have it (the folder, or a world with the same id). */
  installed: boolean
}
