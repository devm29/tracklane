import { type MutationActor, type Team, type User, canAccessTeam } from "@tracklane/domain";
import type { WorkspaceRepository } from "../repositories/workspace.repository.js";

export interface AccessContext {
  user: User;
  actor: MutationActor;
  teams: Team[];
  teamIds: string[];
}

export function actorOf(user: User): MutationActor {
  return { userId: user.id, workspaceId: user.workspaceId, role: user.role };
}

export class AccessService {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  async contextFor(user: User): Promise<AccessContext> {
    const actor = actorOf(user);
    const teams = (await this.workspaces.listTeams(user.workspaceId)).filter((team) => canAccessTeam(team, actor));
    return { user, actor, teams, teamIds: teams.map((team) => team.id) };
  }
}
