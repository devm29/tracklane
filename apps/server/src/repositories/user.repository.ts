import type { User } from "@tracklane/domain";
import { toUser } from "../db/mappers.js";
import type { Models, UserDoc } from "../db/models.js";

export class UserRepository {
  constructor(private readonly models: Models) {}

  async findById(id: string): Promise<User | null> {
    const doc = await this.models.User.findById(id).lean<UserDoc>();
    return doc ? toUser(doc) : null;
  }

  async findCredentials(email: string): Promise<{ user: User; passwordHash: string } | null> {
    const doc = await this.models.User.findOne({ email: email.toLowerCase() }).lean<UserDoc>();
    return doc ? { user: toUser(doc), passwordHash: doc.passwordHash } : null;
  }

  async listByWorkspace(workspaceId: string): Promise<User[]> {
    const docs = await this.models.User.find({ workspaceId }).sort({ role: 1, name: 1 }).lean<UserDoc[]>();
    return docs.map(toUser);
  }
}
