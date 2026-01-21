// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export interface SelectItem {
    label: string;
    value: string;
}

export interface SelectAreaProps {
    items: SelectItem[];
    onSelect: (value: string) => void;
}

export const SelectArea: React.FC<SelectAreaProps> = ({ items, onSelect }) => {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan">
            <Text color="green">Select one:</Text>
            <SelectInput
                items={items}
                onSelect={(item) => onSelect(item.value)}
            />
        </Box>
    );
};
