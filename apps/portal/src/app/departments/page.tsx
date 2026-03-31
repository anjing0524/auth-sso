/**
 * 部门管理页面
 * 展示部门树结构，支持增删改查
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';

/**
 * 部门数据类型
 */
interface Department {
  id: string;
  publicId: string;
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  children: Department[];
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
 * 部门树节点组件
 */
function DepartmentNode({
  dept,
  level = 0,
  expanded,
  onToggle,
  onSelect,
  selectedId,
}: {
  dept: Department;
  level?: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (dept: Department) => void;
  selectedId: string | null;
}) {
  const hasChildren = dept.children && dept.children.length > 0;
  const isExpanded = expanded.has(dept.id);
  const isSelected = selectedId === dept.id;

  return (
    <div>
      <div
        className={`flex items-center py-2 px-3 hover:bg-gray-50 cursor-pointer rounded-md ${isSelected ? 'bg-blue-50' : ''}`}
        style={{ paddingLeft: `${level * 24 + 12}px` }}
        onClick={() => onSelect(dept)}
      >
        {/* 展开/收起按钮 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(dept.id);
          }}
          className="w-5 h-5 mr-2 flex items-center justify-center text-gray-400"
        >
          {hasChildren ? (
            <svg
              className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* 图标 */}
        <svg className="w-5 h-5 text-blue-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>

        {/* 名称 */}
        <span className="text-sm font-medium text-gray-900">{dept.name}</span>

        {/* 状态 */}
        {dept.status === 'DISABLED' && (
          <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">已禁用</span>
        )}

        {/* 编码 */}
        {dept.code && (
          <span className="ml-2 text-xs text-gray-400">{dept.code}</span>
        )}
      </div>

      {/* 子节点 */}
      {hasChildren && isExpanded && (
        <div>
          {dept.children.map((child) => (
            <DepartmentNode
              key={child.id}
              dept={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 部门管理页面组件
 */
export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    sort: 0,
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED',
  });

  /**
   * 获取部门树
   */
  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/departments');
      const data = await response.json();
      if (response.ok) {
        setDepartments(data.data);
        // 默认展开所有
        const allIds = new Set<string>();
        const collectIds = (depts: Department[]) => {
          depts.forEach(d => {
            if (d.children?.length) {
              allIds.add(d.id);
              collectIds(d.children);
            }
          });
        };
        collectIds(data.data);
        setExpanded(allIds);
      }
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  /**
   * 切换展开状态
   */
  const handleToggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /**
   * 选择部门
   */
  const handleSelect = (dept: Department) => {
    setSelectedDept(dept);
  };

  /**
   * 打开新建模态框
   */
  const handleNew = (parent?: Department) => {
    setEditingDept(null);
    setFormData({
      name: '',
      code: '',
      sort: 0,
      status: 'ACTIVE',
    });
    setShowModal(true);
  };

  /**
   * 打开编辑模态框
   */
  const handleEdit = () => {
    if (!selectedDept) return;
    setEditingDept(selectedDept);
    setFormData({
      name: selectedDept.name,
      code: selectedDept.code || '',
      sort: selectedDept.sort,
      status: selectedDept.status,
    });
    setShowModal(true);
  };

  /**
   * 保存部门
   */
  const handleSave = async () => {
    try {
      const url = editingDept ? `/api/departments/${editingDept.id}` : '/api/departments';
      const method = editingDept ? 'PUT' : 'POST';

      const body = {
        ...formData,
        parentId: selectedDept?.id || null,
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        setShowModal(false);
        fetchDepartments();
      }
    } catch (error) {
      console.error('Failed to save department:', error);
    }
  };

  /**
   * 删除部门
   */
  const handleDelete = async () => {
    if (!selectedDept) return;
    if (!confirm(`确定要删除部门 "${selectedDept.name}" 吗？`)) return;

    try {
      const response = await fetch(`/api/departments/${selectedDept.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setSelectedDept(null);
        fetchDepartments();
      }
    } catch (error) {
      console.error('Failed to delete department:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">部门管理</h2>
          <p className="mt-1 text-sm text-gray-500">管理组织架构和部门结构</p>
        </div>
        <button
          onClick={() => handleNew()}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建部门
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 部门树 */}
        <div className="lg:col-span-2 bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">部门架构</h3>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : departments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">暂无部门数据</div>
            ) : (
              <div className="space-y-1">
                {departments.map((dept) => (
                  <DepartmentNode
                    key={dept.id}
                    dept={dept}
                    expanded={expanded}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                    selectedId={selectedDept?.id || null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 部门详情 */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              {selectedDept ? '部门详情' : '请选择部门'}
            </h3>
          </div>
          {selectedDept ? (
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">部门名称</label>
                <p className="mt-1 text-sm text-gray-900">{selectedDept.name}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">部门编码</label>
                <p className="mt-1 text-sm text-gray-900">{selectedDept.code || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">状态</label>
                <p className="mt-1">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedDept.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {selectedDept.status === 'ACTIVE' ? '正常' : '已禁用'}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">排序</label>
                <p className="mt-1 text-sm text-gray-900">{selectedDept.sort}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">创建时间</label>
                <p className="mt-1 text-sm text-gray-900">{formatDate(selectedDept.createdAt)}</p>
              </div>

              <div className="pt-4 flex space-x-3">
                <button
                  onClick={handleEdit}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                >
                  编辑
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 text-sm font-medium rounded-md"
                >
                  删除
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500">
              从左侧选择一个部门查看详情
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
                {editingDept ? '编辑部门' : '新建部门'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">部门名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">部门编码</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
                  <input
                    type="number"
                    value={formData.sort}
                    onChange={(e) => setFormData({ ...formData, sort: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
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