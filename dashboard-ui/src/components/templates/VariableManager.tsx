import React, { useState, useMemo } from 'react';
import { Plus, Search, Trash2, Edit3, Download, Upload, AlertTriangle, Info } from 'lucide-react';
import { CustomVariable, VariableType, VariableManagerProps } from '@/types/variable';
import { useCustomVariables } from '@/hooks/useCustomVariables';
import { useVariableValidation } from '@/hooks/useVariableValidation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';
import { Checkbox } from '@/components/ui/Checkbox';
import { cn } from '@/utils/cn';

interface VariableFormData {
  name: string;
  path: string;
  type: VariableType;
  defaultValue: any;
  description: string;
}

const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True/False' },
  { value: 'url', label: 'URL' },
  { value: 'date', label: 'Date' },
  { value: 'array', label: 'List' },
  { value: 'object', label: 'Object' }
];

export const VariableManager: React.FC<VariableManagerProps> = ({
  onVariablesChange,
  existingVariables,
  usageMap
}) => {
  const {
    variables,
    loading,
    error,
    createVariable,
    updateVariable,
    deleteVariable,
    bulkDelete,
    exportVariables,
    getVariableUsage
  } = useCustomVariables({
    autoLoad: true,
    onError: (error) => console.error('Variable management error:', error)
  });

  const { validateVariable } = useVariableValidation({ existingVariables: variables });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<VariableType | 'all'>('all');
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVariable, setEditingVariable] = useState<CustomVariable | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Form state for create/edit modal
  const [formData, setFormData] = useState<VariableFormData>({
    name: '',
    path: '',
    type: 'string',
    defaultValue: '',
    description: ''
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Filter variables based on search and type
  const filteredVariables = useMemo(() => {
    return variables.filter(variable => {
      const matchesSearch = !searchQuery ||
        variable.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        variable.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        variable.description?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = selectedType === 'all' || variable.type === selectedType;

      return matchesSearch && matchesType;
    });
  }, [variables, searchQuery, selectedType]);

  // Notify parent of changes
  React.useEffect(() => {
    onVariablesChange(variables);
  }, [variables, onVariablesChange]);

  // Reset form
  const resetForm = () => {
    setFormData({
      name: '',
      path: '',
      type: 'string',
      defaultValue: '',
      description: ''
    });
    setFormErrors({});
  };

  // Open create modal
  const handleCreate = () => {
    resetForm();
    setEditingVariable(null);
    setShowCreateModal(true);
  };

  // Open edit modal
  const handleEdit = (variable: CustomVariable) => {
    setFormData({
      name: variable.name,
      path: variable.path,
      type: variable.type,
      defaultValue: variable.defaultValue,
      description: variable.description || ''
    });
    setEditingVariable(variable);
    setFormErrors({});
    setShowCreateModal(true);
  };

  // Validate form data
  const validateForm = async (): Promise<boolean> => {
    const errors: Record<string, string> = {};

    // Create temporary variable for validation
    const tempVariable: CustomVariable = {
      id: editingVariable?.id || 'temp',
      name: formData.name,
      path: formData.path,
      type: formData.type,
      defaultValue: formData.defaultValue,
      description: formData.description,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const validation = validateVariable(tempVariable);

    validation.errors.forEach(error => {
      errors[error.field] = error.message;
    });

    // Auto-generate path if not provided
    if (!formData.path && formData.name) {
      const generatedPath = `custom.${formData.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      setFormData(prev => ({ ...prev, path: generatedPath }));
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async () => {
    const isValid = await validateForm();
    if (!isValid) return;

    try {
      if (editingVariable) {
        await updateVariable(editingVariable.id, formData);
      } else {
        await createVariable(formData);
      }
      setShowCreateModal(false);
      resetForm();
    } catch (error) {
      console.error('Failed to save variable:', error);
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    const usage = usageMap.get(id) || [];
    if (usage.length > 0) {
      // Show warning about usage
      return;
    }

    await deleteVariable(id);
    setShowDeleteConfirm(null);
  };

  // Handle bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedVariables);
    await bulkDelete(ids);
    setSelectedVariables(new Set());
    setShowBulkDeleteConfirm(false);
  };

  // Handle selection
  const handleSelectVariable = (id: string, selected: boolean) => {
    const newSelection = new Set(selectedVariables);
    if (selected) {
      newSelection.add(id);
    } else {
      newSelection.delete(id);
    }
    setSelectedVariables(newSelection);
  };

  // Handle select all
  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedVariables(new Set(filteredVariables.map(v => v.id)));
    } else {
      setSelectedVariables(new Set());
    }
  };

  // Format default value for display
  const formatDefaultValue = (value: any, type: VariableType): string => {
    if (value === null || value === undefined) return 'No default';

    switch (type) {
      case 'boolean':
        return value ? 'True' : 'False';
      case 'array':
      case 'object':
        return JSON.stringify(value);
      default:
        return String(value);
    }
  };

  // Get usage count for a variable
  const getUsageCount = (id: string): number => {
    return usageMap.get(id)?.length || 0;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-center">
          <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-red-700">Failed to load custom variables: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Custom Variables</h2>
          <p className="text-sm text-gray-600 mt-1">
            Create and manage custom variables for your templates
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportVariables()}
            disabled={variables.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Variable
          </Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex items-center space-x-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search variables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as VariableType | 'all')}
          options={[
            { value: 'all', label: 'All Types' },
            ...VARIABLE_TYPES
          ]}
        />
      </div>

      {/* Bulk Actions */}
      {selectedVariables.size > 0 && (
        <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-700">
            {selectedVariables.size} variable(s) selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulkDeleteConfirm(true)}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected
          </Button>
        </div>
      )}

      {/* Variables Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {filteredVariables.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-2">
              <Info className="h-8 w-8 mx-auto" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Custom Variables</h3>
            <p className="text-gray-600 mb-4">
              {variables.length === 0
                ? "You haven't created any custom variables yet."
                : "No variables match your current filters."
              }
            </p>
            {variables.length === 0 && (
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Variable
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <Checkbox
                      checked={selectedVariables.size === filteredVariables.length}
                      indeterminate={selectedVariables.size > 0 && selectedVariables.size < filteredVariables.length}
                      onChange={(checked) => handleSelectAll(checked)}
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Path
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Default Value
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usage
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVariables.map((variable) => {
                  const usageCount = getUsageCount(variable.id);
                  const isSelected = selectedVariables.has(variable.id);

                  return (
                    <tr key={variable.id} className={cn(
                      "hover:bg-gray-50",
                      isSelected && "bg-blue-50"
                    )}>
                      <td className="px-6 py-4">
                        <Checkbox
                          checked={isSelected}
                          onChange={(checked) => handleSelectVariable(variable.id, checked)}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {variable.name}
                          </div>
                          {variable.description && (
                            <div className="text-sm text-gray-500">
                              {variable.description}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                          {variable.path}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="secondary">
                          {VARIABLE_TYPES.find(t => t.value === variable.type)?.label || variable.type}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {formatDefaultValue(variable.defaultValue, variable.type)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <span className="text-sm text-gray-900">{usageCount}</span>
                          {usageCount > 0 && (
                            <Tooltip content="This variable is used in templates">
                              <AlertTriangle className="h-4 w-4 text-amber-500 ml-2" />
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(variable)}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowDeleteConfirm(variable.id)}
                            disabled={usageCount > 0}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={editingVariable ? 'Edit Variable' : 'Create Variable'}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Variable"
              error={formErrors.name}
            />
            <p className="text-xs text-gray-500 mt-1">
              A human-readable name for your variable
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Path *
            </label>
            <Input
              value={formData.path}
              onChange={(e) => setFormData(prev => ({ ...prev, path: e.target.value }))}
              placeholder="custom.myVariable"
              error={formErrors.path}
            />
            <p className="text-xs text-gray-500 mt-1">
              The path used in templates (e.g., custom.myVariable)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type *
            </label>
            <Select
              value={formData.type}
              onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as VariableType }))}
              options={VARIABLE_TYPES}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Value
            </label>
            {formData.type === 'boolean' ? (
              <Select
                value={String(formData.defaultValue)}
                onChange={(e) => setFormData(prev => ({ ...prev, defaultValue: e.target.value === 'true' }))}
                options={[
                  { value: 'true', label: 'True' },
                  { value: 'false', label: 'False' }
                ]}
              />
            ) : formData.type === 'array' || formData.type === 'object' ? (
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                value={typeof formData.defaultValue === 'string' ? formData.defaultValue : JSON.stringify(formData.defaultValue, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    setFormData(prev => ({ ...prev, defaultValue: parsed }));
                  } catch {
                    setFormData(prev => ({ ...prev, defaultValue: e.target.value }));
                  }
                }}
                placeholder={formData.type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
              />
            ) : (
              <Input
                type={formData.type === 'number' ? 'number' : formData.type === 'url' ? 'url' : 'text'}
                value={formData.defaultValue}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  defaultValue: formData.type === 'number' ? Number(e.target.value) : e.target.value
                }))}
                placeholder="Enter default value..."
                error={formErrors.defaultValue}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe what this variable is used for..."
            />
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button
            variant="outline"
            onClick={() => setShowCreateModal(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            {editingVariable ? 'Update' : 'Create'} Variable
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <Modal
          isOpen={true}
          onClose={() => setShowDeleteConfirm(null)}
          title="Delete Variable"
        >
          <div className="space-y-4">
            <p className="text-gray-700">
              Are you sure you want to delete this variable? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(showDeleteConfirm)}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteConfirm && (
        <Modal
          isOpen={true}
          onClose={() => setShowBulkDeleteConfirm(false)}
          title="Delete Variables"
        >
          <div className="space-y-4">
            <p className="text-gray-700">
              Are you sure you want to delete {selectedVariables.size} variable(s)? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowBulkDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
              >
                Delete All
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
