/**
 * 角色权限管理页面
 * 展示角色列表，支持角色权限配置
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';

/**
 * 角色数据类型
 */
interface Role {
  id: string;
  publicId: string;
  name: string;
  code: string;
  description: string | null;
  dataScopeType: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
  isSystem: boolean;
  status: 'ACTIVE' | 'DISABLED';
  sort: number;
  createdAt: string;
}

/**
 * 权限数据类型
 */
interface Permission {
  id: string;
  publicId: string;
  name: string;
  code: string;
  type: 'MENU' | 'API' | 'DATA';
  resource: string | null;
  action: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 数据范围标签
 */
const DATA_SCOPE_LABELS: Record<string, string> = {
  ALL: '全部数据',
  DEPT: '本部门',
  DEPT_AND_SUB: '本部门及子部门',
  SELF: '仅本人',
  CUSTOM: '自定义',
};

/**
 * 角色权限页面组件
 */
export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [keyword, setKeyword] = useState('');

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    dataScopeType: 'SELF' as Role['dataScopeType'],
    sort: 0,
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
  });

  /**
   * 获取角色列表
   */
  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.append('keyword', keyword);

      const response = await fetch(`/api/roles?${params.toString()}`);
      const data = await response.json();
      if (response.ok) {
        setRoles(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  /**
   * 获取权限列表
   */
  const fetchPermissions = useCallback(async () => {
    try {
      const response = await fetch('/api/permissions');
      const data = await response.json();
      if (response.ok) {
        setPermissions(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    }
  }, []);

  /**
   * 获取角色权限
   */
  const fetchRolePermissions = useCallback(async (roleId: string) => {
    try {
      const response = await fetch(`/api/roles/${roleId}/permissions`);
      const data = await response.json();
      if (response.ok) {
        setRolePermissions(new Set(data.data.map((p: Permission) => p.id)));
      }
    } catch (error) {
      console.error('Failed to fetch role permissions:', error);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchPermissions();
  }, [fetchRoles, fetchPermissions]);

  /**
   * 选择角色
   */
  const handleSelectRole = (role: Role) => {
    setSelectedRole(role);
    fetchRolePermissions(role.id);
  };

  /**
   * 打开新建模态框
   */
  const handleNew = () => {
    setEditingRole(null);
    setFormData({
      name: '',
      code: '',
      description: '',
      dataScopeType: 'SELF',
      sort: 0,
      status: 'ACTIVE',
    });
    setShowModal(true);
  };

  /**
   * 打开编辑模态框
   */
  const handleEdit = () => {
    if (!selectedRole) return;
    setEditingRole(selectedRole);
    setFormData({
      name: selectedRole.name,
      code: selectedRole.code,
      description: selectedRole.description || '',
      dataScopeType: selectedRole.dataScopeType,
      sort: selectedRole.sort,
      status: selectedRole.status,
    });
    setShowModal(true);
  };

  /**
   * 保存角色
   */
  const handleSave = async () => {
    try {
      const url = editingRole ? `/api/roles/${editingRole.id}` : '/api/roles';
      const method = editingRole ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setShowModal(false);
        fetchRoles();
      }
    } catch (error) {
      console.error('Failed to save role:', error);
    }
  };

  /**
   * 切换权限
   */
  const handleTogglePermission = async (permissionId: string) => {
    if (!selectedRole) return;

    const newSet = new Set(rolePermissions);
    if (newSet.has(permissionId)) {
      newSet.delete(permissionId);
    } else {
      newSet.add(permissionId);
    }

    try {
      const response = await fetch(`/api/roles/${selectedRole.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionIds: Array.from(newSet),
        }),
      });

      if (response.ok) {
        setRolePermissions(newSet);
      }
    } catch (error) {
      console.error('Failed to update permissions:', error);
    }
  };

  /**
   * 按类型分组权限
   */
  const permissionsByType = permissions.reduce((acc, p) => {
    if (!acc[p.type]) acc[p.type] = [];
    acc[p.type].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">角色权限管理</h2>
          <p className="mt-1 text-sm text-gray-500">配置角色和对应的权限</p>
        </div>
        <button
          onClick={handleNew}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建角色
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 角色列表 */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索角色..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="p-4 text-center text-gray-500">加载中...</div>
            ) : roles.length === 0 ? (
              <div className="p-4 text-center text-gray-500">暂无角色</div>
            ) : (
              roles.map((role) => (
                <div
                  key={role.id}
                  onClick={() => handleSelectRole(role)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${selectedRole?.id === role.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{role.name}</div>
                      <div className="text-xs text-gray-500">{role.code}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {role.isSystem && (
                        <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">系统</span>
                      )}
                      {role.status === 'DISABLED' && (
                        <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">禁用</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 角色详情和权限配置 */}
        <div className="lg:col-span-2 space-y-6">
          {selectedRole ? (
            <>
              {/* 角色信息 */}
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900">角色信息</h3>
                  <button
                    onClick={handleEdit}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    编辑
                  </button>
                </div>
                <div className="p-6 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-500">角色名称</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedRole.name}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">角色编码</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedRole.code}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">数据范围</label>
                    <p className="mt-1 text-sm text-gray-900">{DATA_SCOPE_LABELS[selectedRole.dataScopeType]}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">状态</label>
                    <p className="mt-1">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        selectedRole.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {selectedRole.status === 'ACTIVE' ? '正常' : '已禁用'}
                      </span>
                    </p>
                  </div>
                  {selectedRole.description && (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-500">描述</label>
                      <p className="mt-1 text-sm text-gray-900">{selectedRole.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 权限配置 */}
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">权限配置</h3>
                </div>
                <div className="p-6 space-y-6">
                  {Object.entries(permissionsByType).map(([type, perms]) => (
                    <div key={type}>
                      <h4 className="text-sm font-medium text-gray-700 mb-3">
                        {type === 'MENU' ? '菜单权限' : type === 'API' ? 'API 权限' : '数据权限'}
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {perms.map((perm) => (
                          <label
                            key={perm.id}
                            className={`flex items-center p-2 rounded-md cursor-pointer ${
                              rolePermissions.has(perm.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={rolePermissions.has(perm.id)}
                              onChange={() => handleTogglePermission(perm.id)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm text-gray-700">{perm.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white shadow rounded-lg p-12 text-center text-gray-500">
              请从左侧选择一个角色查看详情和配置权限
            </div>
          )}
        </div>
      </div>

      {/* 编辑/新建模态框 */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowModal(false)} />
            <div className="relative inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {editingRole ? '编辑角色' : '新建角色'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">角色名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">角色编码</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    disabled={!!editingRole}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">数据范围</label>
                  <select
                    value={formData.dataScopeType}
                    onChange={(e) => setFormData({ ...formData, dataScopeType: e.target.value as Role['dataScopeType'] })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="SELF">仅本人</option>
                    <option value="DEPT">本部门</option>
                    <option value="DEPT_AND_SUB">本部门及子部门</option>
                    <option value="ALL">全部数据</option>
                    <option value="CUSTOM">自定义</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'ACTIVE' | 'DISABLED' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="ACTIVE">正常</option>
                    <option value="DISABLED">禁用</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 text-sm font-medium rounded-md"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}