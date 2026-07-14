import { EntryCommand } from "../domain/command/EntryCommand.js";
import { Broker } from "../port/Broker.js";
import { PositionRepository } from "../port/PositionRepository.js";
import { Position } from "../domain/position/Position.js";
import type { EntryExecutor } from "./EntryExecutor.js";

export class EntryExecution implements EntryExecutor {
    constructor(
        private readonly broker: Broker,
        private readonly positionRepository: PositionRepository,
    ) {}

    async openPosition(command: EntryCommand): Promise<void> {
        const result = await this.broker.placeEntry(command);
        const position = Position.open(command, result);
        await this.positionRepository.register(position, command.entrySnapshot);
    }
}